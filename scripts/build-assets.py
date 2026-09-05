"""Create original, editable Cloud Claw assets. Blender 5.x, no external add-ons."""
import bpy
import math
import os
import random
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models')
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(ROOT, 'art'), exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
random.seed(17)

def color(hex_value):
    v = hex_value.lstrip('#')
    rgb = [int(v[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((c + .055) / 1.055) ** 2.4 if c > .04045 else c / 12.92 for c in rgb) + (1,)

def material(name, hex_value, metallic=0, roughness=.4, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color(hex_value)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = color(hex_value)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    if emission:
        p.inputs['Emission Color'].default_value = color(hex_value)
        p.inputs['Emission Strength'].default_value = emission
    return m

cream = material('Warm porcelain enamel', '#f2e8ce', .18, .27)
coral = material('Papaya enamel', '#ef805d', .22, .3)
dark = material('Midnight teal powder coat', '#254747', .2, .36)
chrome = material('Brushed champagne metal', '#c9c5ae', .88, .23)
black = material('Licorice eyes and stitching', '#263332', .0, .5)
mint = material('Pistachio rubber', '#cfe396', .08, .52)
pink = material('Rose embroidered nose', '#d17884', 0, .85)
red = material('CoderPush red bandana', '#d63836', 0, .9)
white = material('Cotton embroidery', '#fff8e8', 0, .82)
light = material('Warm inset lighting', '#fff3d3', 0, .35, 2.3)
bed = material('Peach cushion bed', '#e6b099', 0, .9)
blue = material('Periwinkle capsule', '#9fbecb', .1, .38)
violet = material('Lilac capsule', '#b8a6ca', .1, .38)

def fabric(name, base, multicolor=False):
    m = material(name, base, 0, .96)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Sheen Weight'].default_value = .45
    p.inputs['Sheen Roughness'].default_value = .8
    n = 256
    image = bpy.data.images.new(name + ' woven colour', n, n)
    palette = [color(base), color('#ecc4d9'), color('#c4d9da'), color('#eee9ce')]
    pixels = []
    for y in range(n):
        for x in range(n):
            patch = math.sin(x/n*10 + math.sin(y/n*7)*1.6) + math.sin(y/n*11 + .8)
            index = max(0, min(3, int((patch + 2) / 4 * 4))) if multicolor else 0
            grain = random.uniform(.88, 1.07)
            pixels.extend([min(1, c*grain) for c in palette[index][:3]] + [1])
    image.pixels = pixels
    image.pack()
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = image
    m.node_tree.links.new(tex.outputs['Color'], p.inputs['Base Color'])
    return m

plush = fabric('Pastel patchwork plush', '#ece8df', True)
inner = fabric('Blush ear velour', '#e9bac8')
belly = fabric('Vanilla belly velour', '#eee9ce')
grey = fabric('Dove grey travel pillow', '#aab4b3')

def assign(obj, mat):
    obj.data.materials.append(mat)
    if obj.type == 'MESH':
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj

def box(name, loc, scale, mat, bevel=.05):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        m = o.modifiers.new('Soft manufactured edges', 'BEVEL')
        m.width = bevel
        m.segments = 4
        o.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    return assign(o, mat)

def ellipsoid(name, loc, scale, mat, segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    return assign(o, mat)

def cylinder(name, loc, radius, depth, mat, vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o = bpy.context.object
    o.name = name
    bevel = o.modifiers.new('Machined rim', 'BEVEL')
    bevel.width = .025
    bevel.segments = 3
    o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return assign(o, mat)

def tube(name, points, radius, mat):
    c = bpy.data.curves.new(name, 'CURVE')
    c.dimensions = '3D'
    c.resolution_u = 12
    c.bevel_depth = radius
    c.bevel_resolution = 3
    s = c.splines.new('BEZIER')
    s.bezier_points.add(len(points)-1)
    for p, co in zip(s.bezier_points, points):
        p.co = co
        p.handle_left_type = 'AUTO'
        p.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, c)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o

def label(name, text, loc, size, mat, align='CENTER'):
    c = bpy.data.curves.new(name, 'FONT')
    c.body = text
    c.align_x = align
    c.size = size
    c.extrude = .0015
    c.bevel_depth = .0006
    o = bpy.data.objects.new(name, c)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (math.pi/2, 0, 0)
    o.data.materials.append(mat)
    return o

def group(name):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    return o

def export(name, start_objects):
    objects = [o for o in bpy.context.scene.objects if o not in start_objects]
    # Convert curves/fonts so both the editable scene and export carry identical geometry.
    for o in objects:
        if o.type in {'CURVE', 'FONT'}:
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.convert(target='MESH')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name+'.glb'), export_format='GLB', use_selection=True, export_animations=False, export_extras=True)
    return objects

# CABINET. Blender -Y is the front; glTF exports it as +Z.
before = set(bpy.context.scene.objects)
box('Cabinet plinth', (0, 0, .16), (3.62, 2.7, .28), dark, .13)
body = box('Cabinet body', (0, 0, .63), (3.42, 2.5, .85), coral, .13)
# A real opening connects the upper hopper to the prize outlet.
for name, loc, dimensions in [
    ('Hopper shaft', (-1.02,-.9,1.02),(.76,.56,1.20)),
    ('Prize outlet opening', (-.96,-1.2,.625),(1.14,.66,.43)),
]:
    cutter=box(name,loc,dimensions,dark,0)
    modifier=body.modifiers.new(name,'BOOLEAN');modifier.operation='DIFFERENCE';modifier.object=cutter
    bpy.context.view_layer.objects.active=body
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
box('Prize bed rear', (0,.28,1.105), (3.3,1.80,.14), bed,.03)
box('Prize bed front right', (.505,-.9,1.105), (2.29,.56,.14), bed,.03)
box('Prize bed front left', (-1.525,-.9,1.105), (.25,.56,.14), bed,.03)
for x in [-1.42,-.62]:
    box('Hopper lip side',(x,-.9,1.19),(.035,.57,.025),chrome,.01)
box('Hopper lip rear',(-1.02,-.60,1.19),(.80,.035,.025),chrome,.01)
box('Back wall', (0, 1.19, 2.44), (3.38, .10, 2.67), dark, .045)
# Art deco inset on the back wall.
for x in [-1.25, -.85, -.45, -.05, .35, .75, 1.15]:
    tube('Back wall fluting', [(x, 1.125, 1.28),(x,1.125,3.61)], .009, chrome)
box('Back arch inset', (0, 1.108, 2.66), (1.98, .024, 1.45), dark, .28)
label('Back wall title', 'GOOD THINGS', (0,1.081,2.83), .225, cream)
label('Back wall subtitle', 'ARE WITHIN REACH.', (0,1.080,2.52), .154, mint)
for x in [-1.65,1.65]:
    for y in [-1.18,1.18]:
        box('Upright', (x,y,2.5), (.105,.105,2.87), cream, .04)
        if y > 0:
            box('Inset LED', (x*.963,y-.065,2.47), (.027,.028,2.43), light, .01)
box('Front sill', (0,-1.21,1.21), (3.4,.12,.14), cream, .04)
box('Rear sill', (0,1.21,1.21), (3.4,.12,.14), cream, .04)
box('Top cornice', (0,0,3.97), (3.64,2.68,.3), cream, .11)
box('Marquee coral face', (0,-1.33,3.98), (3.15,.04,.23), coral, .03)
label('Machine title', 'C L O U D   C L A W', (0,-1.363,3.91), .18, dark)
box('Crown', (0,0,4.18), (2.5,1.56,.12), cream, .055)
for x in [-1.4,1.4]:
    for y in [-.94,.94]:
        ellipsoid('Recessed warm light', (x,y,3.797), (.07,.07,.015), light,24,12)
# Chute is visibly distinct from the field.
box('Prize chute dark interior', (-.96,-.871,.60), (1.1,.015,.37), dark, .04)
box('Prize chute inner tray', (-.96,-1.32,.42), (1.12,.32,.045), chrome, .022)
label('Chute label', 'YOURS TO KEEP', (-.96,-1.309,.31), .085, dark)
label('Front brand', 'coderpush.', (.68,-1.282,.65), .24, dark)
label('Front microtype', 'A LITTLE HUMAN MAGIC', (.69,-1.285,.46), .066, dark)
for x in [-1.49,1.49]:
    for z in [.32,.99]:
        screw = cylinder('Cabinet screw', (x,-1.27,z), .023,.012,chrome,16)
        screw.rotation_euler[0]=math.pi/2
# Side porthole badge / moulded horizontal decoration.
for z in [.42,.54,.66,.78]:
    box('Side enamel rib', (1.719,.08,z), (.016,1.48,.027), cream,.013)
cabinet_objects = export('cabinet',before)

# BUNNY. All limbs remain individually addressable for gentle secondary animation.
before = set(bpy.context.scene.objects)
bunny = group('Bunny')
ellipsoid('Body', (0,0,.52), (.34,.25,.4), plush)
ellipsoid('Belly', (0,-.224,.5), (.242,.075,.29), belly)
ellipsoid('Head', (0,-.015,1.065), (.425,.32,.355), plush,40,28)
ellipsoid('Muzzle_left', (-.11,-.304,.967), (.135,.047,.10), belly)
ellipsoid('Muzzle_right', (.11,-.304,.967), (.135,.047,.10), belly)
for x, name in [(-1,'Left'),(1,'Right')]:
    foot=ellipsoid(name+'_Foot', (x*.21,-.105,.137), (.168,.24,.137), plush)
    paw=ellipsoid(name+'_Arm', (x*.358,-.004,.56), (.128,.14,.285), plush)
    paw.rotation_euler[1]=x*-.24
    ear=group(name+'_Ear')
    ear.location=(x*.34,0,1.26)
    outer=ellipsoid(name+'_Ear_velour', (0,0,-.295), (.13,.10,.43), plush)
    outer.parent=ear
    inset=ellipsoid(name+'_Ear_blush', (0,-.091,-.32), (.073,.025,.30),inner)
    inset.parent=ear
    ear.rotation_euler[1]=x*-.23
    eye=ellipsoid(name+'_Eye',(x*.176,-.300,1.105),(.027,.025,.042),black,24,16)
    ellipsoid(name+'_Eye_glint',(x*.174-.006,-.323,1.122),(.008,.005,.010),white,16,8)
    ellipsoid(name+'_Cheek',(x*.25,-.281,1.015),(.055,.012,.031),inner,24,12)
ellipsoid('Nose',(0,-.351,1.035),(.066,.035,.043),pink,24,16)
tube('Smile', [(-.063,-.349,.973),(0,-.359,.951),(.063,-.349,.973)],.007,black)
tube('Nose stitch',[(0,-.355,1.01),(0,-.359,.956)],.006,black)
ellipsoid('Cotton tail',(0,.26,.36),(.12,.12,.12),belly)
# Rounded scarf and triangular hanging bandana.
ellipsoid('Bandana collar',(0,-.014,.803),(.293,.272,.077),red)
mesh=bpy.data.meshes.new('Bandana bib mesh')
mesh.from_pydata([(-.265,-.243,.806),(.265,-.243,.806),(.207,-.298,.601),(0,-.316,.542),(-.207,-.298,.601)],[],[(0,1,2,3,4)])
bib=bpy.data.objects.new('Bandana bib',mesh)
bpy.context.collection.objects.link(bib)
assign(bib,red)
solid=bib.modifiers.new('Cloth thickness','SOLIDIFY');solid.thickness=.013
bevel=bib.modifiers.new('Soft cloth seam','BEVEL');bevel.width=.02;bevel.segments=3
label('Bandana logo','coderpush.',(0,-.315,.681),.082,white)
for o in list(bpy.context.scene.objects):
    if o not in before and o!=bunny and not o.parent:
        o.parent=bunny
bunny_objects=export('bunny',before)

# PILLOW. Swept plush U-shape, not a torus with the opening hidden.
before=set(bpy.context.scene.objects)
pillow=group('Pillow')
verts=[];faces=[]
segments=64;cross=20
for i in range(segments+1):
    angle=math.radians(-40)+i/segments*math.radians(260)
    # U opening points toward -Y (front).
    cx=.31*math.cos(angle);cy=.33*math.sin(angle)
    radius=.145*(.96+.08*math.cos(angle))
    for j in range(cross):
        a=j/cross*2*math.pi
        verts.append((cx+radius*math.cos(a)*math.cos(angle),cy+radius*math.cos(a)*math.sin(angle),.19+.15*math.sin(a)))
for i in range(segments):
    for j in range(cross):
        a=i*cross+j;b=i*cross+(j+1)%cross
        faces.append((a,b,b+cross,a+cross))
faces.append(tuple(reversed(range(cross))))
faces.append(tuple(segments*cross+j for j in range(cross)))
mesh=bpy.data.meshes.new('Pillow padded mesh');mesh.from_pydata(verts,[],faces);mesh.update()
o=bpy.data.objects.new('Pillow velour',mesh);bpy.context.collection.objects.link(o);assign(o,grey)
o.parent=pillow
# Rotate opening toward the front and embroider the upper arc.
o.rotation_euler[2]=math.pi/2
emb=label('Pillow embroidery','coderpush.',(0,.21,.327),.10,black)
emb.rotation_euler=(0,0,0);emb.parent=pillow
pillow_objects=export('pillow',before)

# CLAW. Hub and three jointed steel fingers with curved rubber tips.
before=set(bpy.context.scene.objects)
claw=group('Claw')
cylinder('Claw shoulder',(0,0,0),.18,.20,chrome)
cylinder('Claw coral ring',(0,0,-.09),.194,.06,coral)
ellipsoid('Claw dome',(0,0,.095),(.178,.178,.11),chrome)
cylinder('Cable socket',(0,0,.22),.051,.14,dark)
for i in range(3):
    angle=i*math.tau/3
    pivot=group('Finger_'+str(i))
    pivot.location=(0,0,-.08)
    pivot.rotation_euler[2]=angle
    arm=tube('Finger steel_'+str(i),[(.13,0,0),(.29,0,-.22),(.40,0,-.48),(.30,0,-.66),(.15,0,-.72)],.031,chrome)
    arm.parent=pivot
    pad=tube('Rubber grip_'+str(i),[(.32,-.002,-.637),(.25,-.002,-.694),(.15,-.002,-.72)],.039,dark)
    pad.parent=pivot
    knuckle=ellipsoid('Finger joint_'+str(i),(.155,0,-.02),(.055,.065,.055),chrome,24,12);knuckle.parent=pivot
for o in list(bpy.context.scene.objects):
    if o not in before and o!=claw and not o.parent:o.parent=claw
claw_objects=export('claw',before)

# Arrange all exported assets into an editable art direction scene.
bunny.location=(-.85,-.12,1.19);bunny.scale=(.76,.76,.76)
pillow.location=(.64,.12,1.2);pillow.scale=(1.0,1.0,1.0)
claw.location=(-.4,-.15,3.32)
# Add two linked bunny variations for the .blend presentation.
for offset in [( .64,.56,1.19),(-.85,.55,1.19)]:
    lookup={}
    for source in bunny_objects:
        duplicate=source.copy()
        if source.data:duplicate.data=source.data
        bpy.context.collection.objects.link(duplicate)
        lookup[source]=duplicate
    for source,duplicate in lookup.items():
        duplicate.parent=lookup.get(source.parent)
    lookup[bunny].location=offset
    lookup[bunny].scale=(.65,.65,.65)

bpy.ops.object.camera_add(location=(6,-10,6.1))
camera=bpy.context.object;camera.name='Art direction camera'
camera.rotation_euler=(Vector((0,0,2.1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=6.4
bpy.context.scene.camera=camera
for loc,energy,size in [((1,-4,7),1500,5),((-5,-1,5),1000,5),((2,4,6),1700,4)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    l=bpy.context.object;l.data.energy=energy;l.data.shape='DISK';l.data.size=size
    l.rotation_euler=(Vector((0,0,2))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.context.scene.world.color=(.4,.4,.4)
bpy.context.scene.render.engine='CYCLES'
bpy.context.scene.cycles.samples=32
bpy.context.scene.render.resolution_x=1400
bpy.context.scene.render.resolution_y=1400
bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.film_transparent=True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'art','cloud-claw.blend'))
print('Cloud Claw assets created: cabinet, bunny, pillow, claw and editable Blender scene.')
