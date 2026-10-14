export function sanitizeHtmlToText(value) {
  const parsed = new DOMParser().parseFromString(String(value), "text/html");
  parsed.querySelectorAll("script, style, iframe, object, embed, svg, math, template")
    .forEach(element => element.remove());
  return parsed.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
}
