def make_recommendation(fault):

    recommendations = {

        "normal":
            "No immediate action required.",

        "congestion":
            "Check load balancing and traffic distribution.",

        "high_cpu":
            "Investigate overloaded network equipment and CPU usage.",

        "high_latency":
            "Check congestion, routing and backhaul connectivity.",

        "packet_loss":
            "Check signal quality, network equipment and transport connectivity.",

        "low_throughput":
            "Check radio conditions, traffic utilization and available network capacity."
    }

    return recommendations.get(
        fault,
        "Investigate the network manually."
    )