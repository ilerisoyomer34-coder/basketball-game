using UnityEngine;
using UnityEngine.SceneManagement;

public class MainMenuController : MonoBehaviour
{
    public string matchSceneName = "Game";

    public void StartMatch()
    {
        SceneManager.LoadScene(matchSceneName);
    }

    public void QuitGame()
    {
        Application.Quit();
    }
}
