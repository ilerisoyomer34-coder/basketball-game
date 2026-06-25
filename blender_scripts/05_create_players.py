"""
OYUNCU MODELI - Blender Python Script (stilize, parametrik düşük-poligon basketbolcu)
Headless çalıştırma: blender --background --python 05_create_players.py

Not: Bu prosedürel script gerçek bir insanın yüzünü/görünümünü üretemez (fotogerçekçi
likeness için elle heykel/3D tarama gerekir); stilize bir "spor manken" figürü üretir.
Forma rengi, numarası ve boy/yapı ölçeği her oyuncu için Unity tarafında
(BasketballSceneBuilder.cs) ayrı ayrı uygulanır.

Üretir:
  - Assets/Models/Player.fbx
    (Player_Root > Head, Torso, Hips, Arm_L/R, Hand_L/R, Leg_L/R, Shoe_L/R, HandAnchor_R empty)
"""

import bpy
import math
import os

PROJECT_ROOT = "/Users/ILERISOY/basketball-game"
MODELS_DIR = os.path.join(PROJECT_ROOT, "Assets", "Models")
os.makedirs(MODELS_DIR, exist_ok=True)


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


def make_material(name, color, metallic=0.0, roughness=0.6):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def assign_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def add_empty(name, loc):
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=loc, radius=0.05)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def add_sphere(name, loc, radius, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return obj


def add_round_limb(name, loc, radius, depth, rot_x=0.0, rot_y=0.0, verts=10):
    # Blender'da hazır kapsül primitive'i yok; yuvarlatılmış silindirle uzuv hissi veriyoruz.
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc,
                                         end_fill_type='NGON')
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    bpy.ops.object.modifier_add(type='BEVEL')
    obj.modifiers["Bevel"].width = radius * 0.6
    obj.modifiers["Bevel"].segments = 3
    bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.rotation_euler = (rot_x, rot_y, 0.0)
    bpy.ops.object.transform_apply(rotation=True)
    return obj


def add_box(name, loc, size):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(scale=True)
    return obj


def create_player():
    mat_jersey = make_material("M_Jersey", (0.85, 0.1, 0.1), roughness=0.75)
    mat_shorts = make_material("M_Shorts", (0.15, 0.15, 0.18), roughness=0.75)
    mat_skin = make_material("M_Skin", (0.65, 0.47, 0.35), roughness=0.55)
    mat_shoe = make_material("M_Shoe", (0.95, 0.95, 0.95), roughness=0.4)

    root = add_empty("Player_Root", (0, 0, 0))

    # ── Bacaklar ──
    leg_h = 0.85
    leg_r = 0.10
    for side, x in (("L", -0.13), ("R", 0.13)):
        leg = add_round_limb(f"Leg_{side}", (x, 0, leg_h / 2), leg_r, leg_h)
        assign_material(leg, mat_skin)
        leg.parent = root

        shoe = add_box(f"Shoe_{side}", (x, 0.05, 0.04), (0.13, 0.27, 0.08))
        assign_material(shoe, mat_shoe)
        shoe.parent = root

    # ── Kalça / şort ──
    hips_h = 0.26
    hips_z = leg_h + hips_h / 2
    hips = add_box("Hips", (0, 0, hips_z), (0.34, 0.24, hips_h))
    assign_material(hips, mat_shorts)
    hips.parent = root

    # ── Gövde / forma ──
    torso_h = 0.52
    torso_z = hips_z + hips_h / 2 + torso_h / 2
    torso = add_box("Torso", (0, 0, torso_z), (0.40, 0.22, torso_h))
    assign_material(torso, mat_jersey)
    torso.parent = root

    # ── Kollar (gövdenin yanında, hafif açık) ──
    arm_h = 0.60
    arm_r = 0.07
    shoulder_z = torso_z + torso_h / 2 - 0.04
    for side, x_sign in (("L", -1), ("R", 1)):
        x_shoulder = 0.24 * x_sign
        x_hand = 0.30 * x_sign
        arm_center = ((x_shoulder + x_hand) / 2, 0, shoulder_z - arm_h / 2)
        tilt = math.radians(8 * x_sign)
        arm = add_round_limb(f"Arm_{side}", arm_center, arm_r, arm_h, rot_y=tilt)
        assign_material(arm, mat_skin)
        arm.parent = root

        hand = add_sphere(f"Hand_{side}", (x_hand, 0, shoulder_z - arm_h - 0.02), 0.075, segments=10, rings=8)
        assign_material(hand, mat_skin)
        hand.parent = root

    # ── Baş ──
    head_r = 0.13
    head_z = shoulder_z + 0.10 + head_r
    head = add_sphere("Head", (0, 0, head_z), head_r)
    assign_material(head, mat_skin)
    head.parent = root

    # ── Top tutma referans noktası (sağ el önünde) ──
    hand_anchor = add_empty("HandAnchor_R", (0.30, 0.32, shoulder_z - 0.08))
    hand_anchor.parent = root

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
    create_player()
    out_path = os.path.join(MODELS_DIR, "Player.fbx")
    export_fbx(out_path)
    print(f"[OK] Oyuncu modeli export edildi: {out_path}")


if __name__ == "__main__":
    main()
