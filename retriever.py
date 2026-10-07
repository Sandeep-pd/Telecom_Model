import re
from functools import lru_cache
from pathlib import Path
from typing import TypedDict

from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langgraph.graph import END, StateGraph


class RetrievalState(TypedDict):
    query: str
    context: str


def _resolve_knowledge_path() -> Path:
    candidates = [
        Path("data/telecom_knowledge.txt"),
        Path("telecom_knowledge.txt"),
        Path(__file__).resolve().parent / "data" / "telecom_knowledge.txt",
        Path(__file__).resolve().parent / "telecom_knowledge.txt",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "Telecom knowledge file was not found. Expected data/telecom_knowledge.txt "
        "or telecom_knowledge.txt."
    )


def _normalize_fault(fault: str) -> str:
    return re.sub(r"[_\s]+", " ", fault.strip().lower())


def _retrieve_context(state: RetrievalState) -> RetrievalState:
    query = state["query"]
    retrievers = _get_retriever()
    retriever = retrievers.get(_normalize_fault(query))
    if retriever is None:
        return {"query": query, "context": "No relevant telecom knowledge found."}

    documents = retriever.invoke(query.replace("_", " "))
    context = "\n\n".join(document.page_content for document in documents)
    if not context:
        context = "No relevant telecom knowledge found."
    return {"query": query, "context": context}


@lru_cache(maxsize=1)
def _get_retriever() -> dict[str, BM25Retriever]:
    knowledge_path = _resolve_knowledge_path()
    knowledge = knowledge_path.read_text(encoding="utf-8")
    headings = list(re.finditer(r"(?m)^([A-Z][A-Z ]+)$", knowledge))
    documents = [
        Document(
            page_content=knowledge[heading.start():headings[index + 1].start() if index + 1 < len(headings) else len(knowledge)].strip(),
            metadata={"fault": _normalize_fault(heading.group(1))},
        )
        for index, heading in enumerate(headings)
    ]
    if not documents:
        raise ValueError(f"Telecom knowledge file is empty: {knowledge_path}")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
    )
    documents = splitter.split_documents(documents)
    fault_documents: dict[str, list[Document]] = {}
    for document in documents:
        fault_documents.setdefault(document.metadata["fault"], []).append(document)
    return {
        fault: BM25Retriever.from_documents(fault_docs, k=len(fault_docs))
        for fault, fault_docs in fault_documents.items()
    }


def _build_retrieval_graph():
    graph = StateGraph(RetrievalState)
    graph.add_node("retrieve_knowledge", _retrieve_context)
    graph.set_entry_point("retrieve_knowledge")
    graph.add_edge("retrieve_knowledge", END)
    return graph.compile()


@lru_cache(maxsize=1)
def _get_retrieval_graph():
    return _build_retrieval_graph()


def search_knowledge(fault: str) -> str:
    """Retrieve telecom knowledge for a predicted fault through LangGraph."""
    result = _get_retrieval_graph().invoke({"query": fault, "context": ""})
    return result["context"]
