def diagnose_network(
    fault,
    cpu,
    traffic,
    packet_loss,
    latency
):

    if fault == "congestion":

        return (
            f"Possible network congestion. "
            f"Traffic is {traffic}% and CPU is {cpu}%."
        )

    elif fault == "high_cpu":

        return (
            f"High CPU utilization detected. "
            f"Current CPU usage is {cpu}%."
        )

    elif fault == "high_latency":

        return (
            f"High network latency detected. "
            f"Current latency is {latency} ms."
        )

    elif fault == "packet_loss":

        return (
            f"High packet loss detected. "
            f"Current packet loss is {packet_loss}%."
        )

    else:

        return "Network appears to be operating normally."