"""
BASKETBOL POTASI MODELI - Blender Python Script
Headless çalıştırma: blender --background --python 01_create_hoop.py

Üretir:
  - Assets/Models/Hoop.fbx  (Backboard, Pole, Arm, Rim, Net, ScoreTrigger_Top/Bottom empty'leri)
  - Assets/Textures/net_alpha.png  (file dokusu - alpha cutout)
"""

import bpy
import bmesh
import math
import os
import numpy as np

PROJECT_ROOT = "/Users/ILERISOY/basketball-game"
MODELS_DIR = os.path.join(PROJECT_ROOT, "Assets", "Models")
TEXTURES_DIR = os.path.join(PROJECT_ROOT, "Assets", "Textures")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(TEXTURES_DIR, exist_ok=True)

# ─── ÖLÇÜLER (metre) ─────────────────────────────────────────
RIM_HEIGHT = 3.05          # Yerden file çemberine yükseklik (resmi NBA ölçüsü)
RIM_RADIUS = 0.2286        # 18 inch çap / 2
RIM_TUBE_RADIUS = 0.012
BACKBOARD_W = 1.83
BACKBOARD_H = 1.07
BACKBOARD_T = 0.03
BACKBOARD_CENTER_Z = 3.45
POLE_RADIUS = 0.06
POLE_HEIGHT = 3.3
POLE_Y = 0.95
NET_DEPTH = 0.40


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


def make_material(name, color, metallic=0.0, roughness=0.6, alpha=1.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.blend_method = 'BLEND'
    return mat


def assign_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def add_box(name, loc, size):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(scale=True)
    return obj


def add_cylinder(name, loc, radius, depth, verts=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def add_torus(name, loc, major_r, minor_r, major_seg=32, minor_seg=12):
    bpy.ops.mesh.primitive_torus_add(
        location=loc, major_radius=major_r, minor_radius=minor_r,
        major_segments=major_seg, minor_segments=minor_seg)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def add_empty(name, loc):
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=loc, radius=0.05)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def create_net_alpha_texture(path, size=512):
    """Diamond örgü deseni - alpha cutout file dokusu."""
    x = np.linspace(0, 1, size)
    y = np.linspace(0, 1, size)
    xx, yy = np.meshgrid(x, y)
    freq = 14.0
    diamond = np.abs(np.sin((xx + yy) * math.pi * freq)) + np.abs(np.sin((xx - yy) * math.pi * freq))
    mask = (diamond < 0.35).astype(np.float32)  # ince çizgiler = file ipi
    rgba = np.zeros((size, size, 4), dtype=np.float32)
    rgba[..., 0] = 1.0
    rgba[..., 1] = 1.0
    rgba[..., 2] = 1.0
    rgba[..., 3] = mask
    img = bpy.data.images.new("net_alpha", width=size, height=size, alpha=True)
    img.pixels = rgba.flatten().tolist()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return path


def make_net_material(image_path):
    mat = bpy.data.materials.new(name="M_Net")
    mat.use_nodes = True
    mat.blend_method = 'CLIP'
    mat.alpha_threshold = 0.3
    mat.show_transparent_back = False
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(image_path)
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs['Roughness'].default_value = 0.9
    return mat


def create_net_mesh(name, center, top_radius, bottom_radius, depth, rings=8, segments=24):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts_rings = []
    for r in range(rings + 1):
        t = r / rings
        radius = top_radius + (bottom_radius - top_radius) * t
        z = -depth * t
        ring_sag = math.sin(t * math.pi) * 0.03  # hafif file sarkması
        ring_verts = []
        for s in range(segments):
            ang = 2 * math.pi * s / segments
            vx = center[0] + math.cos(ang) * radius
            vy = center[1] + math.sin(ang) * radius
            vz = center[2] + z - ring_sag
            ring_verts.append(bm.verts.new((vx, vy, vz)))
        verts_rings.append(ring_verts)
    for r in range(rings):
        for s in range(segments):
            s2 = (s + 1) % segments
            v1 = verts_rings[r][s]
            v2 = verts_rings[r][s2]
            v3 = verts_rings[r + 1][s2]
            v4 = verts_rings[r + 1][s]
            bm.faces.new((v1, v2, v3, v4))
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.uv_layers.new(name="UVMap")
    uv = mesh.uv_layers[0]
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            loop = mesh.loops[li]
            vidx = loop.vertex_index
            ring_idx = vidx // segments
            seg_idx = vidx % segments
            uv.data[li].uv = (seg_idx / segments * 4.0, ring_idx / rings)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def create_hoop():
    mat_backboard = make_material("M_Backboard", (0.85, 0.92, 0.95), metallic=0.1, roughness=0.15, alpha=0.55)
    mat_rim = make_material("M_Rim", (0.85, 0.25, 0.05), metallic=0.6, roughness=0.35)
    mat_pole = make_material("M_Pole", (0.18, 0.18, 0.2), metallic=0.7, roughness=0.4)

    root = add_empty("Hoop_Root", (0, 0, 0))

    pole = add_cylinder("Pole", (0, POLE_Y, POLE_HEIGHT / 2), POLE_RADIUS, POLE_HEIGHT)
    assign_material(pole, mat_pole)
    pole.parent = root

    arm = add_box("Arm", (0, (POLE_Y + 0.12) / 2, BACKBOARD_CENTER_Z + 0.15), (0.12, POLE_Y + 0.12, 0.12))
    assign_material(arm, mat_pole)
    arm.parent = root

    backboard = add_box("Backboard", (0, 0.10, BACKBOARD_CENTER_Z), (BACKBOARD_W, BACKBOARD_T, BACKBOARD_H))
    assign_material(backboard, mat_backboard)
    backboard.parent = root

    rim_y = 0.085 - RIM_RADIUS
    rim = add_torus("Rim", (0, rim_y, RIM_HEIGHT), RIM_RADIUS, RIM_TUBE_RADIUS)
    assign_material(rim, mat_rim)
    rim.parent = root

    net_alpha_path = os.path.join(TEXTURES_DIR, "net_alpha.png")
    create_net_alpha_texture(net_alpha_path)
    mat_net = make_net_material(net_alpha_path)
    net = create_net_mesh("Net", (0, rim_y, RIM_HEIGHT), RIM_RADIUS, RIM_RADIUS * 0.6, NET_DEPTH)
    assign_material(net, mat_net)
    net.parent = root

    score_top = add_empty("ScoreTrigger_Top", (0, rim_y, RIM_HEIGHT + 0.08))
    score_top.parent = root
    score_bottom = add_empty("ScoreTrigger_Bottom", (0, rim_y, RIM_HEIGHT - NET_DEPTH + 0.05))
    score_bottom.parent = root
    floor_mark = add_empty("Basket_FloorMark", (0, rim_y, 0))
    floor_mark.parent = root

    return root


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
        add_leaf_bones=False,
        bake_anim=False,
    )


def main():
    clear_scene()
    setup_units()
    create_hoop()
    out_path = os.path.join(MODELS_DIR, "Hoop.fbx")
    export_fbx(out_path)
    print(f"[OK] Hoop export edildi: {out_path}")


if __name__ == "__main__":
    main()
