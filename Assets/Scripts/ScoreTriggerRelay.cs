using UnityEngine;

public class ScoreTriggerRelay : MonoBehaviour
{
    public bool isTopTrigger;

    HoopScoreDetector detector;

    void Awake()
    {
        detector = GetComponentInParent<HoopScoreDetector>();
    }

    void OnTriggerEnter(Collider other)
    {
        if (detector == null || !other.CompareTag("Ball"))
            return;

        if (isTopTrigger)
            detector.NotifyTop(other);
        else
            detector.NotifyBottom(other);
    }
}
