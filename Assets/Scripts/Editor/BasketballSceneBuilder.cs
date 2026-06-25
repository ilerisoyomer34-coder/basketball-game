using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

public static class BasketballSceneBuilder
{
    const string HoopAssetPath = "Assets/Models/Hoop.fbx";
    const string BallAssetPath = "Assets/Models/Ball.fbx";
    const string CourtAssetPath = "Assets/Models/Court.fbx";
    const string StadiumAssetPath = "Assets/Models/Stadium.fbx";
    const string PlayerAssetPath = "Assets/Models/Player.fbx";
    const string ScenePath = "Assets/Scenes/Game.unity";

    // 03_create_court.py ile birebir aynı saha sabitleri (Blender Y ekseni)
    const float BasketAY = 0.085f - 0.2286f;
    const float CourtLength = 28.65f;
    const float BaselineAY = BasketAY + 1.2f;
    const float BaselineBY = BaselineAY - CourtLength;
    const float BasketBY = BaselineBY + 1.2f;

    static readonly float[] LaneOffsets = { -6f, -3f, 0f, 3f, 6f };
    const float TeamSpawnStandoff = 4f;
    const float OffensiveSlotStandoff = 6f;

    [MenuItem("Basketball/Build Complete Scene")]
    public static void BuildCompleteScene()
    {
        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        GameObject hoopAsset = AssetDatabase.LoadAssetAtPath<GameObject>(HoopAssetPath);
        GameObject ballAsset = AssetDatabase.LoadAssetAtPath<GameObject>(BallAssetPath);
        GameObject courtAsset = AssetDatabase.LoadAssetAtPath<GameObject>(CourtAssetPath);
        GameObject stadiumAsset = AssetDatabase.LoadAssetAtPath<GameObject>(StadiumAssetPath);

        if (hoopAsset == null || ballAsset == null || courtAsset == null || stadiumAsset == null)
        {
            Debug.LogError("[BasketballSceneBuilder] Model dosyaları bulunamadı. Önce blender_scripts/run_all_blender.sh çalıştırılmalı.");
            return;
        }

        GameObject courtInstance = (GameObject)PrefabUtility.InstantiatePrefab(courtAsset);
        courtInstance.name = "Court";
        SetupCourtColliders(courtInstance);

        GameObject stadiumInstance = (GameObject)PrefabUtility.InstantiatePrefab(stadiumAsset);
        stadiumInstance.name = "Stadium";
        SetupStadiumColliders(stadiumInstance);

        // ── Hoop A (sahanın yakın ucu) ──
        GameObject hoopAInstance = (GameObject)PrefabUtility.InstantiatePrefab(hoopAsset);
        hoopAInstance.name = "HoopA";
        Transform hoopARoot = FindDeepChild(hoopAInstance.transform, "Hoop_Root");
        if (hoopARoot == null) hoopARoot = hoopAInstance.transform;
        SetupHoopColliders(hoopARoot);

        Transform rimA = FindDeepChild(hoopARoot, "Rim");
        Vector3 rimAWorldPos = rimA != null ? rimA.position : new Vector3(0f, 3.05f, -BasketAY);

        // ── Hoop B (sahanın uzak ucu, 180° döndürülmüş ayna kopya) ──
        GameObject hoopBInstance = (GameObject)PrefabUtility.InstantiatePrefab(hoopAsset);
        hoopBInstance.name = "HoopB";
        hoopBInstance.transform.rotation = Quaternion.Euler(0f, 180f, 0f);
        Transform hoopBRoot = FindDeepChild(hoopBInstance.transform, "Hoop_Root");
        if (hoopBRoot == null) hoopBRoot = hoopBInstance.transform;

        Transform rimB = FindDeepChild(hoopBRoot, "Rim");
        Vector3 rimBMeasured = rimB != null ? rimB.position : new Vector3(0f, 3.05f, BasketAY);
        Vector3 rimBTarget = new Vector3(0f, rimAWorldPos.y, -BasketBY);
        hoopBInstance.transform.position += rimBTarget - rimBMeasured;

        SetupHoopColliders(hoopBRoot);

        // ── Top ──
        GameObject ballInstance = (GameObject)PrefabUtility.InstantiatePrefab(ballAsset);
        ballInstance.name = "Ball";
        ballInstance.tag = "Ball";

        float centerZ = (rimAWorldPos.z + rimBTarget.z) * 0.5f;
        Vector3 ballRestPos = new Vector3(0f, 1.1f, centerZ);
        ballInstance.transform.position = ballRestPos;

        Rigidbody ballRb = ballInstance.AddComponent<Rigidbody>();
        ballRb.mass = 0.62f;
        ballRb.isKinematic = true;

        SphereCollider ballCol = ballInstance.AddComponent<SphereCollider>();
        ballCol.radius = 0.1213f;
        ballCol.material = CreateBouncyPhysicsMaterial();

        GameObject trajectoryObj = new GameObject("TrajectoryLine");
        trajectoryObj.transform.SetParent(ballInstance.transform, false);
        LineRenderer lr = trajectoryObj.AddComponent<LineRenderer>();
        lr.widthMultiplier = 0.03f;
        lr.material = new Material(Shader.Find("Sprites/Default"));
        lr.startColor = new Color(1f, 1f, 1f, 0.85f);
        lr.endColor = new Color(1f, 1f, 1f, 0.1f);
        lr.useWorldSpace = true;
        TrajectoryPredictor predictor = trajectoryObj.AddComponent<TrajectoryPredictor>();

        BallLauncher launcher = ballInstance.AddComponent<BallLauncher>();
        launcher.trajectoryPredictor = predictor;
        launcher.hoopTarget = rimAWorldPos;
        launcher.SetRestPosition(ballRestPos);

        // ── Takımlar: Ev sahibi HoopB'ye hücum eder / HoopA'yı savunur, konuk tersi ──
        GameObject homeRoot = new GameObject("Team_Home");
        GameObject awayRoot = new GameObject("Team_Away");

        PlayerCharacter[] homePlayers = CreateTeam(homeRoot.transform, Team.Home, centerZ - TeamSpawnStandoff, firstIsHuman: true);
        PlayerCharacter[] awayPlayers = CreateTeam(awayRoot.transform, Team.Away, centerZ + TeamSpawnStandoff, firstIsHuman: false);

        foreach (PlayerCharacter p in homePlayers)
        {
            p.offensiveHoop = rimB;
            p.defensiveHoop = rimA;
        }
        foreach (PlayerCharacter p in awayPlayers)
        {
            p.offensiveHoop = rimA;
            p.defensiveHoop = rimB;
        }

        PlayerCharacter[] allPlayers = homePlayers.Concat(awayPlayers).ToArray();
        launcher.allPlayers = allPlayers;

        WireTeamAI(homePlayers, awayPlayers, launcher, rimBTarget, approachFromNegativeZ: true);
        WireTeamAI(awayPlayers, homePlayers, launcher, rimAWorldPos, approachFromNegativeZ: false);

        Camera cam = SetupFollowCamera(homePlayers[0].transform);
        HumanPlayerInput humanInput = homePlayers[0].GetComponent<HumanPlayerInput>();
        if (humanInput != null) humanInput.followCamera = cam;

        // ── Skor tetikleyicileri ──
        HoopScoreDetector detectorA = hoopARoot.gameObject.AddComponent<HoopScoreDetector>();
        hoopARoot.gameObject.tag = "Hoop";
        SetupScoreTrigger(hoopARoot, "ScoreTrigger_Top", true);
        SetupScoreTrigger(hoopARoot, "ScoreTrigger_Bottom", false);
        SetupNetCloth(hoopARoot, ballCol);

        HoopScoreDetector detectorB = hoopBRoot.gameObject.AddComponent<HoopScoreDetector>();
        hoopBRoot.gameObject.tag = "Hoop";
        SetupScoreTrigger(hoopBRoot, "ScoreTrigger_Top", true);
        SetupScoreTrigger(hoopBRoot, "ScoreTrigger_Bottom", false);
        SetupNetCloth(hoopBRoot, ballCol);

        SetupLight();

        UIManager uiManager;
        SetupUI(out uiManager);

        GameObject gmGO = new GameObject("GameManager");
        GameManager gameManager = gmGO.AddComponent<GameManager>();
        gameManager.ballLauncher = launcher;
        gameManager.homeScoringHoop = detectorB;
        gameManager.awayScoringHoop = detectorA;
        gameManager.uiManager = uiManager;
        gameManager.initialBallCarrier = homePlayers[0];
        uiManager.gameManager = gameManager;

        EnsureScenesDirectory();
        EditorSceneManager.SaveScene(scene, ScenePath);
        AssetDatabase.SaveAssets();
        Debug.Log("[BasketballSceneBuilder] Sahne oluşturuldu ve kaydedildi: " + ScenePath);
    }

    static PlayerCharacter[] CreateTeam(Transform parent, Team team, float spawnZ, bool firstIsHuman)
    {
        var players = new PlayerCharacter[LaneOffsets.Length];
        for (int i = 0; i < LaneOffsets.Length; i++)
        {
            Vector3 spawnPos = new Vector3(LaneOffsets[i], 0f, spawnZ);
            bool isHuman = firstIsHuman && i == 0;
            players[i] = CreatePlayerCharacter(parent, team, i, spawnPos, isHuman);
        }
        return players;
    }

    static PlayerCharacter CreatePlayerCharacter(Transform parent, Team team, int index, Vector3 groundPos, bool isHuman)
    {
        GameObject playerAsset = AssetDatabase.LoadAssetAtPath<GameObject>(PlayerAssetPath);
        Color teamColor = team == Team.Home ? new Color(0.85f, 0.15f, 0.15f) : new Color(0.15f, 0.35f, 0.85f);
        GameObject rootGO;

        if (playerAsset != null)
        {
            GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(playerAsset);
            instance.name = $"{team}_Player_{index}";
            instance.transform.SetParent(parent, false);
            instance.transform.position = groundPos;

            Transform playerRoot = FindDeepChild(instance.transform, "Player_Root");
            rootGO = (playerRoot != null ? playerRoot : instance.transform).gameObject;

            Transform torso = FindDeepChild(instance.transform, "Torso");
            if (torso != null)
            {
                Material mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                mat.color = teamColor;
                torso.GetComponent<Renderer>().sharedMaterial = mat;
            }
        }
        else
        {
            // Player.fbx üretilmemişse (blender_scripts/run_all_blender.sh çalıştırılmadıysa) yedek olarak basit bir kapsül kullan.
            rootGO = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            rootGO.transform.SetParent(parent, false);
            rootGO.transform.position = groundPos + Vector3.up * 1f;
            Object.DestroyImmediate(rootGO.GetComponent<CapsuleCollider>());

            Material mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            mat.color = teamColor;
            rootGO.GetComponent<Renderer>().sharedMaterial = mat;
        }

        rootGO.name = $"{team}_Player_{index}";

        CharacterController cc = rootGO.AddComponent<CharacterController>();
        cc.height = 1.9f;
        cc.radius = 0.3f;
        cc.center = new Vector3(0f, 0.95f, 0f);

        PlayerCharacter player = rootGO.AddComponent<PlayerCharacter>();
        player.team = team;
        player.jerseyNumber = index + 4;
        player.playerName = team == Team.Home ? $"Ev #{player.jerseyNumber}" : $"Konuk #{player.jerseyNumber}";
        player.isHumanControlled = isHuman;

        Transform handAnchor = FindDeepChild(rootGO.transform, "HandAnchor_R");
        if (handAnchor != null) player.handAnchor = handAnchor;

        if (isHuman)
            rootGO.AddComponent<HumanPlayerInput>();

        return player;
    }

    static void WireTeamAI(PlayerCharacter[] team, PlayerCharacter[] opponents, BallLauncher launcher, Vector3 offensiveHoopPos, bool approachFromNegativeZ)
    {
        for (int i = 0; i < team.Length; i++)
        {
            PlayerCharacter p = team[i];
            if (p.isHumanControlled) continue;

            TeamAIController ai = p.gameObject.AddComponent<TeamAIController>();
            ai.ball = launcher;
            ai.teammates = team;
            ai.opponents = opponents;

            float laneOffset = LaneOffsets[i];
            float z = approachFromNegativeZ ? offensiveHoopPos.z - OffensiveSlotStandoff : offensiveHoopPos.z + OffensiveSlotStandoff;
            ai.homeSlotPosition = new Vector3(laneOffset, 0f, z);
        }
    }

    static Transform FindDeepChild(Transform parent, string name)
    {
        if (parent.name == name) return parent;
        foreach (Transform child in parent)
        {
            Transform result = FindDeepChild(child, name);
            if (result != null) return result;
        }
        return null;
    }

    static void SetupCourtColliders(GameObject courtInstance)
    {
        Transform floor = FindDeepChild(courtInstance.transform, "Floor");
        if (floor != null) floor.gameObject.AddComponent<MeshCollider>();
    }

    static List<Transform> GetAllDescendants(Transform root)
    {
        var result = new List<Transform>();
        foreach (Transform child in root)
        {
            result.Add(child);
            result.AddRange(GetAllDescendants(child));
        }
        return result;
    }

    static void SetupStadiumColliders(GameObject stadiumInstance)
    {
        foreach (Transform t in GetAllDescendants(stadiumInstance.transform))
        {
            bool isPhysicalBoundary = t.name.Contains("_Row") || t.name.StartsWith("AdBoard_");
            if (isPhysicalBoundary && t.GetComponent<MeshFilter>() != null && t.GetComponent<Collider>() == null)
                t.gameObject.AddComponent<MeshCollider>();
        }
    }

    static void SetupHoopColliders(Transform hoopRoot)
    {
        foreach (string name in new[] { "Backboard", "Pole", "Arm", "Rim" })
        {
            Transform t = FindDeepChild(hoopRoot, name);
            if (t != null) t.gameObject.AddComponent<MeshCollider>();
        }
    }

    static PhysicsMaterial CreateBouncyPhysicsMaterial()
    {
        var mat = new PhysicsMaterial("BallPhysics");
        mat.bounciness = 0.65f;
        mat.dynamicFriction = 0.4f;
        mat.staticFriction = 0.4f;
        mat.bounceCombine = PhysicsMaterialCombine.Maximum;
        return mat;
    }

    static Camera SetupFollowCamera(Transform target)
    {
        GameObject camGO = new GameObject("Main Camera");
        camGO.tag = "MainCamera";
        Camera cam = camGO.AddComponent<Camera>();
        camGO.AddComponent<AudioListener>();
        cam.fieldOfView = 65f;

        ThirdPersonCamera follow = camGO.AddComponent<ThirdPersonCamera>();
        follow.target = target;
        camGO.transform.position = target.position + follow.offset;
        camGO.transform.LookAt(target.position + Vector3.up * 1.2f);

        return cam;
    }

    static void SetupScoreTrigger(Transform hoopRoot, string emptyName, bool isTop)
    {
        Transform t = FindDeepChild(hoopRoot, emptyName);
        if (t == null) return;

        SphereCollider col = t.gameObject.AddComponent<SphereCollider>();
        col.isTrigger = true;
        col.radius = 0.22f;
        t.gameObject.tag = "ScoreTrigger";

        ScoreTriggerRelay relay = t.gameObject.AddComponent<ScoreTriggerRelay>();
        relay.isTopTrigger = isTop;
    }

    static void SetupNetCloth(Transform hoopRoot, SphereCollider ballCollider)
    {
        Transform net = FindDeepChild(hoopRoot, "Net");
        if (net == null) return;

        MeshFilter mf = net.GetComponent<MeshFilter>();
        MeshRenderer mr = net.GetComponent<MeshRenderer>();
        if (mf == null || mr == null) return;

        Mesh netMesh = mf.sharedMesh;
        Material netMat = mr.sharedMaterial;
        Object.DestroyImmediate(mf);
        Object.DestroyImmediate(mr);

        SkinnedMeshRenderer smr = net.gameObject.AddComponent<SkinnedMeshRenderer>();
        smr.sharedMesh = netMesh;
        smr.sharedMaterial = netMat;

        Cloth cloth = net.gameObject.AddComponent<Cloth>();
        Vector3[] verts = netMesh.vertices;
        float maxY = verts.Length > 0 ? verts.Max(v => v.y) : 0f;
        var coeffs = new ClothSkinningCoefficient[verts.Length];
        for (int i = 0; i < verts.Length; i++)
        {
            coeffs[i] = new ClothSkinningCoefficient
            {
                maxDistance = verts[i].y >= maxY - 0.01f ? 0f : 0.18f,
                collisionSphereDistance = 0f
            };
        }
        cloth.coefficients = coeffs;
        cloth.stretchingStiffness = 0.85f;
        cloth.bendingStiffness = 0.4f;
        cloth.damping = 0.4f;
        cloth.useGravity = true;

        if (ballCollider != null)
            cloth.sphereColliders = new[] { new ClothSphereColliderPair(ballCollider) };
    }

    static void SetupLight()
    {
        GameObject lightGO = new GameObject("Directional Light");
        Light light = lightGO.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1.2f;
        light.shadows = LightShadows.Soft;
        lightGO.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
    }

    static void SetupUI(out UIManager uiManager)
    {
        GameObject esGO = new GameObject("EventSystem");
        esGO.AddComponent<UnityEngine.EventSystems.EventSystem>();
        esGO.AddComponent<UnityEngine.EventSystems.StandaloneInputModule>();

        GameObject canvasGO = new GameObject("Canvas");
        Canvas canvas = canvasGO.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        CanvasScaler scaler = canvasGO.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);
        canvasGO.AddComponent<GraphicRaycaster>();

        Font font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

        Text homeScoreText = CreateText(canvasGO.transform, "HomeScoreText", font, "EV: 0", 36,
            new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(20f, -20f), new Vector2(300f, 50f), TextAnchor.UpperLeft);

        Text awayScoreText = CreateText(canvasGO.transform, "AwayScoreText", font, "KONUK: 0", 36,
            new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(20f, -70f), new Vector2(300f, 50f), TextAnchor.UpperLeft);

        Text timerText = CreateText(canvasGO.transform, "TimerText", font, "Süre: 300", 36,
            new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(-20f, -20f), new Vector2(300f, 50f), TextAnchor.UpperRight);

        GameObject panelGO = new GameObject("GameOverPanel");
        panelGO.transform.SetParent(canvasGO.transform, false);
        RectTransform panelRect = panelGO.AddComponent<RectTransform>();
        panelRect.anchorMin = Vector2.zero;
        panelRect.anchorMax = Vector2.one;
        panelRect.offsetMin = Vector2.zero;
        panelRect.offsetMax = Vector2.zero;
        Image panelImg = panelGO.AddComponent<Image>();
        panelImg.color = new Color(0f, 0f, 0f, 0.75f);
        panelGO.SetActive(false);

        Text finalScoreText = CreateText(panelGO.transform, "FinalScoreText", font, "Oyun Bitti!", 48,
            new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, 40f), new Vector2(500f, 80f), TextAnchor.MiddleCenter);

        GameObject buttonGO = CreateButton(panelGO.transform, "RestartButton", font, "Tekrar Oyna",
            new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, -40f), new Vector2(220f, 60f));
        Button restartButton = buttonGO.GetComponent<Button>();

        GameObject uiManagerGO = new GameObject("UIManager");
        UIManager mgr = uiManagerGO.AddComponent<UIManager>();
        mgr.homeScoreText = homeScoreText;
        mgr.awayScoreText = awayScoreText;
        mgr.timerText = timerText;
        mgr.gameOverPanel = panelGO;
        mgr.finalScoreText = finalScoreText;
        mgr.restartButton = restartButton;
        uiManager = mgr;
    }

    static Text CreateText(Transform parent, string name, Font font, string content, int fontSize,
        Vector2 anchorMin, Vector2 anchorMax, Vector2 anchoredPos, Vector2 sizeDelta, TextAnchor alignment)
    {
        GameObject go = new GameObject(name);
        go.transform.SetParent(parent, false);
        RectTransform rect = go.AddComponent<RectTransform>();
        rect.anchorMin = anchorMin;
        rect.anchorMax = anchorMax;
        rect.anchoredPosition = anchoredPos;
        rect.sizeDelta = sizeDelta;
        Text text = go.AddComponent<Text>();
        text.font = font;
        text.fontSize = fontSize;
        text.text = content;
        text.color = Color.white;
        text.alignment = alignment;
        return text;
    }

    static GameObject CreateButton(Transform parent, string name, Font font, string label,
        Vector2 anchorMin, Vector2 anchorMax, Vector2 anchoredPos, Vector2 sizeDelta)
    {
        GameObject go = new GameObject(name);
        go.transform.SetParent(parent, false);
        RectTransform rect = go.AddComponent<RectTransform>();
        rect.anchorMin = anchorMin;
        rect.anchorMax = anchorMax;
        rect.anchoredPosition = anchoredPos;
        rect.sizeDelta = sizeDelta;
        Image img = go.AddComponent<Image>();
        img.color = new Color(0.2f, 0.6f, 0.95f, 1f);
        go.AddComponent<Button>();

        GameObject textGO = new GameObject("Text");
        textGO.transform.SetParent(go.transform, false);
        RectTransform textRect = textGO.AddComponent<RectTransform>();
        textRect.anchorMin = Vector2.zero;
        textRect.anchorMax = Vector2.one;
        textRect.offsetMin = Vector2.zero;
        textRect.offsetMax = Vector2.zero;
        Text text = textGO.AddComponent<Text>();
        text.font = font;
        text.text = label;
        text.alignment = TextAnchor.MiddleCenter;
        text.color = Color.white;
        text.fontSize = 24;

        return go;
    }

    static void EnsureScenesDirectory()
    {
        if (!AssetDatabase.IsValidFolder("Assets/Scenes"))
            AssetDatabase.CreateFolder("Assets", "Scenes");
    }
}
