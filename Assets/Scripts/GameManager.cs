using UnityEngine;

[RequireComponent(typeof(AudioSource))]
public class GameManager : MonoBehaviour
{
    [Header("Referanslar")]
    public BallLauncher ballLauncher;
    public HoopScoreDetector homeScoringHoop;
    public HoopScoreDetector awayScoringHoop;
    public UIManager uiManager;
    public PlayerCharacter initialBallCarrier;

    [Header("Oyun Ayarları")]
    public float roundDuration = 300f;

    AudioSource audioSource;
    AudioClip scoreChimeClip;
    AudioClip buzzerClip;

    int homeScore;
    int awayScore;
    float timeRemaining;
    bool gameOver;

    void Awake()
    {
        audioSource = GetComponent<AudioSource>();
        audioSource.playOnAwake = false;
        scoreChimeClip = ProceduralAudio.CreateScoreChime();
        buzzerClip = ProceduralAudio.CreateBuzzer();

        if (homeScoringHoop != null) homeScoringHoop.OnScore += HandleHomeScore;
        if (awayScoringHoop != null) awayScoringHoop.OnScore += HandleAwayScore;
        if (ballLauncher != null) ballLauncher.OnBallSettled += HandleBallSettled;
    }

    void OnDestroy()
    {
        if (homeScoringHoop != null) homeScoringHoop.OnScore -= HandleHomeScore;
        if (awayScoringHoop != null) awayScoringHoop.OnScore -= HandleAwayScore;
        if (ballLauncher != null) ballLauncher.OnBallSettled -= HandleBallSettled;
    }

    void Start()
    {
        StartGame();
    }

    void Update()
    {
        if (gameOver) return;

        timeRemaining -= Time.deltaTime;
        if (timeRemaining <= 0f)
        {
            timeRemaining = 0f;
            EndGame();
        }
        uiManager?.UpdateTimer(timeRemaining);
    }

    public void StartGame()
    {
        homeScore = 0;
        awayScore = 0;
        timeRemaining = roundDuration;
        gameOver = false;
        uiManager?.UpdateScore(homeScore, awayScore);
        uiManager?.UpdateTimer(timeRemaining);
        uiManager?.HideGameOver();

        if (ballLauncher != null)
        {
            if (initialBallCarrier != null)
                ballLauncher.AttachToCarrier(initialBallCarrier);
            else
                ballLauncher.ResetForNextShot();
        }
    }

    public void RestartGame()
    {
        StartGame();
    }

    void HandleHomeScore()
    {
        if (gameOver) return;
        homeScore++;
        uiManager?.UpdateScore(homeScore, awayScore);
        audioSource.PlayOneShot(scoreChimeClip);
    }

    void HandleAwayScore()
    {
        if (gameOver) return;
        awayScore++;
        uiManager?.UpdateScore(homeScore, awayScore);
        audioSource.PlayOneShot(scoreChimeClip);
    }

    void HandleBallSettled()
    {
        if (gameOver) return;
        // Takım modunda top serbest kalır; en yakın oyuncu BallLauncher.CheckForPickup ile otomatik sahiplenir.
        // Oyuncu listesi olmayan eski tek-toplu pratik sahnesinde topu hemen tekrar atışa hazırlıyoruz.
        if (ballLauncher != null && (ballLauncher.allPlayers == null || ballLauncher.allPlayers.Length == 0))
            ballLauncher.ResetForNextShot();
    }

    void EndGame()
    {
        gameOver = true;
        audioSource.PlayOneShot(buzzerClip);
        uiManager?.ShowGameOver(homeScore, awayScore);
    }
}
