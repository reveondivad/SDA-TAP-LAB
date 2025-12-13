// Sample HYPT test data for demo scenario
export default [
  {
    "id": "hyp1001",
    "timestamp": 1723559600000,
    "headers": {
      "x-client-dn": "CN=Anomaly Hypothesis, KST=Hypothesis,OU=Services,O=Katalyst Space Technologies"
    },
    "HYPCOLLECTION": {
      "RECORDS": [
        {
          "ID": "63604",
          "NAME": "SHIYAN 27F",
          "CATEGORY": "SATELLITE STATUS DEMO",
          "COUNTRY_CODE": "CN",
          "ANALYSIS_METHOD": "Orbital Pattern Analysis",
          "EVENT_START_TIME": "2025-05-17T00:47:00.000Z",
          "EVENT_END_TIME": "2025-05-17T00:52:00.000Z",
          "PRIORITY": "4",  // This will change to "2" during the demo
          "DEMO": true,  // Flag to enable demo mode
          "SENSOR_LOCATION": {
            "latitude": 35.1983,  // Flagstaff, Arizona
            "longitude": -111.6513,
            "altitude": 100  // Optional, in meters above ground
          },
          "CAT_IDS": [
            "63604"
          ],
          "SIT_IDS": [
            "situation-fengyun-monitoring"
          ],
          "ROW_INDICATORS": [
            "Indicator Status"
          ],
          "COL_INDICATORS": [
            "ORB",
            "VMAG",
            "AMR",
            "TC",
            "LV_LS",
            "DeltaV",
            "AGE"
          ],
          "MATRIX": [
            // Row 0: Status indicators for the entity
            true, null, null, null, true, false, true
          ],
          "SCORE": [
            {
              "OBJECT_ID": "54824", 
              "VALUE": 0.78,
              "CONFIDENCE": 0.93,
              "ALGORITHM": "SYSTEM_STATUS_ANALYSIS"
            }
          ]
        }
      ]
    }
  }
]