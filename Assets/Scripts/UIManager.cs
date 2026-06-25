using UnityEngine;
using UnityEngine.UI;

public class UIManager : MonoBehaviour
{
    public Text homeScoreText;
    public Text awayScoreText;
    public Text timerText;
    public GameObject gameOverPanel;
    public Text finalScoreText;
    public Button restartButton;
    public GameManager gameManager;

    void Awake()
    {
        if (restartButton != null)
            restartButton.onClick.AddListener(() => gameManager?.RestartGame());
    }

    public void UpdateScore(int homeScore, int awayScore)
    {
        if (homeScoreText != null) homeScoreText.text = $"EV: {homeScore}";
        if (awayScoreText != null) awayScoreText.text = $"KONUK: {awayScore}";
    }

    public void UpdateTimer(float time)
    {
        if (timerText != null) timerText.text = $"Süre: {Mathf.CeilToInt(time)}";
    }

    public void ShowGameOver(int homeScore, int awayScore)
    {
        if (gameOverPanel != null) gameOverPanel.SetActive(true);
        if (finalScoreText != null)
        {
            string result = homeScore == awayScore
                ? "Berabere!"
                : (homeScore > awayScore ? "Ev Sahibi Kazandı!" : "Konuk Kazandı!");
            finalScoreText.text = $"{result}\nEV {homeScore} - {awayScore} KONUK";
        }
    }

    public void HideGameOver()
    {
        if (gameOverPanel != null) gameOverPanel.SetActive(false);
    }
}
