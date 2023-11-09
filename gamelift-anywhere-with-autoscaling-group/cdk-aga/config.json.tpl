{
    "CustomizedMetricSpecification": {
        "Metrics": [
            {
                "Label": "Percent Available Game Sessions",
                "Id": "m1",
                "MetricStat": {
                    "Metric": {
                        "MetricName": "PercentAvailableGameSessions",
                        "Namespace": "AWS/GameLift",
                        "Dimensions": [
                            {
                                "Name": "FleetId",
                                "Value": ""
                            },
                            {
                                "Name": "Location",
                                "Value": "custom-anywhere-location"
                            }
                        ]
                    },
                    "Stat": "Average"
                },
                "ReturnData": false
            },
            {
                "Label": "Percent Active Game Sessions",
                "Id": "e1",
                "Expression": "100 - m1",
                "ReturnData": true
            }
        ]
    },
    "TargetValue": 70
}
