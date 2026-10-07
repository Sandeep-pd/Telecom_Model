from fault_prediction import predict_fault


result = predict_fault(
    cpu=92,
    traffic=95,
    packet_loss=2,
    latency=70,
    signal_strength=-70,
    throughput=40
)

print("Prediction:")
print(result)