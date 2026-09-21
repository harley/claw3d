"""Blender: smooth the licensed hand surfaces, preserving the weighted rig.
Run: Blender --background --python scripts/art/refine-hands.py -- SOURCE_DIR OUTPUT_DIR
Inputs: left-source.glb and right-source.glb from WebXR generic-hand (see asset README).
"""
import bpy
import sys
from pathlib import Path
source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
for role in ('left', 'right'):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source / f'{role}-source.glb'))
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new('Anatomical surface refinement', 'SUBSURF')
        mod.levels = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    bpy.ops.export_scene.gltf(filepath=str(output / f'{role}.glb'), export_format='GLB', export_animations=False)
