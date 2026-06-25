"""
STADYUM MODELI - Blender Python Script (tribün + seyirci + reklam panoları)
Headless çalıştırma: blender --background --python 04_create_stadium.py

Üretir:
  - Assets/Models/Stadium.fbx (Bleachers_*, Crowd, AdBoards)
  - Assets/Textures/ad_board_*.png (kurgusal reklam panosu dokuları)

Not: Saha ölçüleri 03_create_court.py ile birebir aynı sabitlerden türetilir
     (BASELINE_A_Y / BASELINE_B_Y / SIDELINE_X). Gerçek marka/logo KULLANILMAZ;
     tüm sponsor isimleri kurgusaldır (telif riskinden kaçınmak için).
"""

import bpy
import bmesh
import math
import os
import random
import numpy as np
from mathutils import Matrix

PROJECT_ROOT = "/Users/ILERISOY/basketball-game"
MODELS_DIR = os.path.join(PROJECT_ROOT, "Assets", "Models")
TEXTURES_DIR = os.path.join(PROJECT_ROOT, "Assets", "Textures")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(TEXTURES_DIR, exist_ok=True)

random.seed(42)

# ─── 03_create_court.py İLE BİREBİR AYNI SAHA SABİTLERİ ──────────────────────
BASKET_A_Y = 0.085 - 0.2286
COURT_LENGTH = 28.65
SIDELINE_X = 7.5

BASELINE_A_Y = BASKET_A_Y + 1.2
BASELINE_B_Y = BASELINE_A_Y - COURT_LENGTH

COURT_X_MIN, COURT_X_MAX = -SIDELINE_X - 0.5, SIDELINE_X + 0.5
COURT_Y_MAX = BASELINE_A_Y + 0.5
COURT_Y_MIN = BASELINE_B_Y - 0.5

# ─── TRİBÜN / SEYİRCİ AYARLARI ────────────────────────────────────────────────
AD_BOARD_GAP = 0.6      # saha kenarından reklam panosuna mesafe
AD_BOARD_HEIGHT = 1.0
AD_BOARD_THICKNESS = 0.06

BLEACHER_START = AD_BOARD_GAP + 0.8   # saha kenarından ilk tribün sırasına mesafe
ROWS_PER_SIDE = 12
ROW_HEIGHT = 0.45
ROW_DEPTH = 0.85
FIGURE_SPACING = 1.0

JERSEY_COLORS = [
    (0.75, 0.08, 0.08), (0.08, 0.20, 0.65), (0.85, 0.65, 0.05),
    (0.10, 0.45, 0.20), (0.55, 0.10, 0.55), (0.90, 0.90, 0.90),
    (0.15, 0.15, 0.15), (0.85, 0.35, 0.05),
]
SKIN_COLORS = [
    (0.80, 0.60, 0.45), (0.55, 0.38, 0.25), (0.95, 0.80, 0.65), (0.35, 0.22, 0.14),
]


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)


def setup_units():
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0


def make_material(name, color, metallic=0.0, roughness=0.8):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


# ─── REKLAM PANOSU DOKULARI (kurgusal sponsor) ───────────────────────────────
def create_ad_board_texture(path, bg_color, accent_color, size=(1024, 256)):
    w, h = size
    img_arr = np.zeros((h, w, 4), dtype=np.float32)
    img_arr[..., 0] = bg_color[0]
    img_arr[..., 1] = bg_color[1]
    img_arr[..., 2] = bg_color[2]
    img_arr[..., 3] = 1.0

    # üst ve alt ince şerit
    img_arr[: int(h * 0.10), :, 0:3] = accent_color
    img_arr[int(h * 0.90):, :, 0:3] = accent_color

    # ince dış çerçeve
    border = max(2, int(h * 0.015))
    img_arr[:, :border, 0:3] = accent_color
    img_arr[:, -border:, 0:3] = accent_color

    rng = random.Random(hash(tuple(bg_color)) & 0xFFFF)

    # Sol tarafta dairesel "amblem" (gerçek logo değil, soyut disk + halka)
    yy, xx = np.mgrid[0:h, 0:w]
    emblem_cx, emblem_cy = w * 0.13, h * 0.5
    emblem_r = h * 0.32
    dist = np.sqrt((xx - emblem_cx) ** 2 + (yy - emblem_cy) ** 2)
    ring_mask = (dist < emblem_r) & (dist > emblem_r * 0.7)
    disc_mask = dist < emblem_r * 0.45
    img_arr[ring_mask, 0:3] = accent_color
    img_arr[disc_mask, 0:3] = accent_color

    # Sağ tarafta "wordmark bloğu" hissi veren dikdörtgenler (gerçek yazı değil, soyut)
    n_blocks = rng.randint(3, 6)
    cursor = w * 0.32
    block_h = h * 0.40
    y0 = (h - block_h) / 2
    for _ in range(n_blocks):
        bw = rng.uniform(0.05, 0.11) * w
        if cursor + bw > w * 0.94:
            break
        x0 = int(cursor)
        x1 = int(cursor + bw)
        img_arr[int(y0):int(y0 + block_h), x0:x1, 0:3] = accent_color
        cursor += bw + w * 0.03

    img = bpy.data.images.new("ad_board_tex", width=w, height=h, alpha=True)
    img.pixels = img_arr.flatten().tolist()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return path


def make_ad_board_material(name, image_path):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(image_path)
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs['Roughness'].default_value = 0.4
    return mat


SPONSOR_PALETTE = [
    ((0.85, 0.1, 0.1), (1.0, 1.0, 1.0)),
    ((0.05, 0.25, 0.65), (1.0, 0.85, 0.1)),
    ((0.1, 0.55, 0.2), (1.0, 1.0, 1.0)),
    ((0.95, 0.75, 0.05), (0.1, 0.1, 0.1)),
    ((0.2, 0.2, 0.2), (0.9, 0.2, 0.2)),
    ((0.5, 0.05, 0.5), (1.0, 1.0, 1.0)),
]


def create_ad_board_materials():
    mats = []
    for i, (bg, accent) in enumerate(SPONSOR_PALETTE):
        path = os.path.join(TEXTURES_DIR, f"ad_board_{i}.png")
        create_ad_board_texture(path, bg, accent)
        mats.append(make_ad_board_material(f"M_AdBoard_{i}", path))
    return mats


def create_ad_boards(root):
    mats = create_ad_board_materials()
    board_len = 2.2
    boards = []

    def place_run(x0, y0, x1, y1):
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        n = max(1, int(length // board_len))
        ux, uy = dx / length, dy / length
        for i in range(n):
            t = (i + 0.5) * length / n
            cx, cy = x0 + ux * t, y0 + uy * t
            yaw = math.atan2(dy, dx)
            bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, AD_BOARD_HEIGHT / 2))
            obj = bpy.context.active_object
            obj.name = f"AdBoard_{len(boards)}"
            obj.rotation_euler[2] = yaw
            obj.scale = (length / n / 2 * 0.96, AD_BOARD_THICKNESS / 2, AD_BOARD_HEIGHT / 2)
            bpy.ops.object.transform_apply(scale=True)
            obj.data.materials.append(mats[len(boards) % len(mats)])
            obj.parent = root
            boards.append(obj)

    gx0, gx1 = COURT_X_MIN - AD_BOARD_GAP, COURT_X_MAX + AD_BOARD_GAP
    gy0, gy1 = COURT_Y_MIN - AD_BOARD_GAP, COURT_Y_MAX + AD_BOARD_GAP

    place_run(gx0, gy1, gx1, gy1)  # A baseline
    place_run(gx0, gy0, gx1, gy0)  # B baseline
    place_run(gx0, gy0, gx0, gy1)  # sol sideline
    place_run(gx1, gy0, gx1, gy1)  # sağ sideline
    return boards


# ─── TRİBÜN (kademeli) ────────────────────────────────────────────────────────
def create_bleacher_side(root, side_name, edge_distance, length, rows, mat_a, mat_b):
    """edge_distance: saha kenarından bu tribün tarafının başladığı uzaklık.
    Tribün 'derinlik' eksenine göre inşa edilip çağıran tarafından konumlandırılır."""
    objs = []
    for r in range(rows):
        dist = edge_distance + BLEACHER_START + r * ROW_DEPTH
        height = (r + 1) * ROW_HEIGHT
        mat = mat_a if r % 2 == 0 else mat_b
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        obj = bpy.context.active_object
        obj.name = f"{side_name}_Row{r}"
        obj.scale = (length / 2, ROW_DEPTH / 2, height / 2)
        bpy.ops.object.transform_apply(scale=True)
        obj.location = (0, dist, height / 2)
        obj.data.materials.append(mat)
        obj.parent = root
        objs.append((obj, dist, height))
    return objs


def build_bleachers_and_crowd(root):
    mat_seat_a = make_material("M_Seat_A", (0.55, 0.08, 0.08), roughness=0.7)
    mat_seat_b = make_material("M_Seat_B", (0.45, 0.06, 0.06), roughness=0.7)

    jersey_mats = [make_material(f"M_Crowd_Jersey_{i}", c, roughness=0.85) for i, c in enumerate(JERSEY_COLORS)]
    skin_mats = [make_material(f"M_Crowd_Skin_{i}", c, roughness=0.6) for i, c in enumerate(SKIN_COLORS)]

    crowd_bm = bmesh.new()
    crowd_material_list = jersey_mats + skin_mats
    skin_index_offset = len(jersey_mats)

    def add_cone_op(matrix, segments, r1, r2, depth, cap_ends=True):
        before = len(crowd_bm.faces)
        bmesh.ops.create_cone(crowd_bm, cap_ends=cap_ends, segments=segments,
                               radius1=r1, radius2=r2, depth=depth, matrix=matrix)
        crowd_bm.faces.ensure_lookup_table()
        return list(crowd_bm.faces)[before:]

    def add_icosphere_op(matrix, radius, subdivisions=0):
        before = len(crowd_bm.faces)
        bmesh.ops.create_icosphere(crowd_bm, subdivisions=subdivisions, radius=radius, matrix=matrix)
        crowd_bm.faces.ensure_lookup_table()
        return list(crowd_bm.faces)[before:]

    def build_seated_figure(loc, facing_yaw):
        body_h = 0.5
        body_r = 0.16
        jersey_idx = random.randrange(len(jersey_mats))
        skin_idx = skin_index_offset + random.randrange(len(skin_mats))

        base_mat = Matrix.Translation(loc) @ Matrix.Rotation(facing_yaw, 4, 'Z')

        mat_body = base_mat @ Matrix.Translation((0, 0, body_h / 2))
        for f in add_cone_op(mat_body, 7, body_r, body_r * 0.85, body_h):
            f.material_index = jersey_idx

        head_r = 0.11
        mat_head = base_mat @ Matrix.Translation((0, 0, body_h + head_r * 0.9))
        for f in add_icosphere_op(mat_head, head_r):
            f.material_index = skin_idx

        # Kollar: çoğu seyirci kolunu yanında dururken bir kısmı havaya kaldırmış
        # (tribünde tek düze değil, canlı bir kalabalık hissi için).
        arm_len = 0.30
        arm_r = 0.045
        raised_side = random.choice((-1, 1)) if random.random() < 0.18 else 0
        for side in (-1, 1):
            x = body_r * 0.95 * side
            if side == raised_side:
                arm_mat = base_mat @ Matrix.Translation((x, 0, body_h + arm_len * 0.5))
            else:
                arm_mat = base_mat @ Matrix.Translation((x, 0, body_h * 0.5))
            for f in add_cone_op(arm_mat, 5, arm_r, arm_r * 0.7, arm_len):
                f.material_index = skin_idx

    def populate_side(edge_distance, length, axis, sign, base_x, base_y, swap_xy):
        for r in range(ROWS_PER_SIDE):
            dist = edge_distance + BLEACHER_START + r * ROW_DEPTH
            seat_z = (r + 1) * ROW_HEIGHT + 0.05
            n = max(1, int(length // FIGURE_SPACING))
            for i in range(n):
                t = (i + 0.5) * length / n - length / 2
                if swap_xy:
                    fx, fy = sign * dist, t
                    yaw = -math.pi / 2 if sign > 0 else math.pi / 2
                else:
                    fx, fy = t, sign * dist
                    yaw = math.pi if sign > 0 else 0.0
                if random.random() < 0.12:
                    continue  # boş koltuk varyasyonu
                build_seated_figure((base_x + fx, base_y + fy, 0.0), yaw)

    court_cx = (COURT_X_MIN + COURT_X_MAX) / 2
    court_cy = (COURT_Y_MIN + COURT_Y_MAX) / 2
    half_w = (COURT_X_MAX - COURT_X_MIN) / 2
    half_l = (COURT_Y_MAX - COURT_Y_MIN) / 2

    bleacher_objs = []
    # A ve B baseline tribünleri (uzunluk = saha genişliği)
    side_len_baseline = COURT_X_MAX - COURT_X_MIN
    rootA = bpy.data.objects.new("Bleachers_BaselineA", None)
    bpy.context.collection.objects.link(rootA)
    rootA.location = (court_cx, COURT_Y_MAX, 0)
    rootA.parent = root
    bleacher_objs += create_bleacher_side(rootA, "BaselineA", 0, side_len_baseline, ROWS_PER_SIDE, mat_seat_a, mat_seat_b)
    populate_side(0, side_len_baseline, 'y', 1, court_cx, COURT_Y_MAX, swap_xy=False)

    rootB = bpy.data.objects.new("Bleachers_BaselineB", None)
    bpy.context.collection.objects.link(rootB)
    rootB.location = (court_cx, COURT_Y_MIN, 0)
    rootB.rotation_euler[2] = math.pi
    rootB.parent = root
    bleacher_objs += create_bleacher_side(rootB, "BaselineB", 0, side_len_baseline, ROWS_PER_SIDE, mat_seat_a, mat_seat_b)
    populate_side(0, side_len_baseline, 'y', -1, court_cx, COURT_Y_MIN, swap_xy=False)

    # Sol ve sağ sideline tribünleri (uzunluk = saha boyu)
    side_len_sideline = COURT_Y_MAX - COURT_Y_MIN
    rootL = bpy.data.objects.new("Bleachers_SideL", None)
    bpy.context.collection.objects.link(rootL)
    rootL.location = (COURT_X_MIN, court_cy, 0)
    rootL.rotation_euler[2] = math.pi / 2
    rootL.parent = root
    bleacher_objs += create_bleacher_side(rootL, "SideL", 0, side_len_sideline, ROWS_PER_SIDE, mat_seat_a, mat_seat_b)
    populate_side(0, side_len_sideline, 'x', -1, COURT_X_MIN, court_cy, swap_xy=True)

    rootR = bpy.data.objects.new("Bleachers_SideR", None)
    bpy.context.collection.objects.link(rootR)
    rootR.location = (COURT_X_MAX, court_cy, 0)
    rootR.rotation_euler[2] = -math.pi / 2
    rootR.parent = root
    bleacher_objs += create_bleacher_side(rootR, "SideR", 0, side_len_sideline, ROWS_PER_SIDE, mat_seat_a, mat_seat_b)
    populate_side(0, side_len_sideline, 'x', 1, COURT_X_MAX, court_cy, swap_xy=True)

    crowd_mesh = bpy.data.meshes.new("CrowdMesh")
    crowd_bm.normal_update()
    crowd_bm.to_mesh(crowd_mesh)
    crowd_bm.free()
    for m in crowd_material_list:
        crowd_mesh.materials.append(m)
    crowd_obj = bpy.data.objects.new("Crowd", crowd_mesh)
    bpy.context.collection.objects.link(crowd_obj)
    crowd_obj.parent = root

    return bleacher_objs, crowd_obj


def export_fbx(filepath):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.fbx(
        filepath=filepath,
        use_selection=True,
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options='FBX_SCALE_ALL',
        axis_forward='-Z',
        axis_up='Y',
        object_types={'MESH', 'EMPTY'},
        use_mesh_modifiers=True,
        mesh_smooth_type='FACE',
        bake_anim=False,
    )


def main():
    clear_scene()
    setup_units()

    root = bpy.data.objects.new("Stadium_Root", None)
    bpy.context.collection.objects.link(root)

    create_ad_boards(root)
    build_bleachers_and_crowd(root)

    out_path = os.path.join(MODELS_DIR, "Stadium.fbx")
    export_fbx(out_path)
    print(f"[OK] Stadium export edildi: {out_path}")


if __name__ == "__main__":
    main()
