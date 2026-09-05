"""Create original, editable Cloud Claw assets. Blender 5.x, no external add-ons."""
import bpy
import math
import os
import random
import sys
import json
from mathutils import Vector, Quaternion

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

cream = material('Satin warm white enamel', '#e7e5da', .0, .60)
coral = material('Racing red enamel', '#a92f37', .0, .58)
dark = material('Black powder coated steel', '#303833', .08, .76)
chrome = material('Brushed stainless steel', '#bfc6c2', .65, .48)
for enamel in [cream, coral]:
    enamel.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value = .08
black = material('Licorice eyes and stitching', '#263332', .0, .5)
mint = material('Pistachio rubber', '#cfe396', .08, .52)
pink = material('Rose embroidered nose', '#d17884', 0, .85)
red = material('CoderPush red bandana', '#d63836', 0, .9)
white = material('Cotton embroidery', '#fff8e8', 0, .82)
light = material('White LED diffuser', '#f7edd7', 0, .65, 1.1)
red_light = material('Red perimeter neon', '#db5e4e', 0, .65, .85)
gold_light = material('Amber marquee lamps', '#f5d9a2', 0, .55, 1.3)
sign_ink = material('Marquee warm white lettering', '#f5ecd6', 0, .75, .25)
bed = material('Woven sage prize bed', '#6d8176', 0, .98)
backdrop = material('Matte pale sage interior', '#bcc7bd', 0, .94)
claw_steel = material('Satin charcoal claw steel', '#6f7c78', .38, .42)
blue = material('Periwinkle capsule', '#9fbecb', .1, .38)
violet = material('Lilac capsule', '#b8a6ca', .1, .38)

def fabric(name, base, multicolor=False):
    m = material(name, base, 0, .96)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Sheen Weight'].default_value = .45
    p.inputs['Sheen Roughness'].default_value = .8
    n = 256
    image = bpy.data.images.new(name + ' woven colour', n, n)
    palette = [color(base), color('#e9b0d1'), color('#a9d6e6'), color('#ede8d4')]
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

display_font = bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Arial Black.ttf')
label_font = bpy.data.fonts.load('/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf')

def label(name, text, loc, size, mat, align='CENTER'):
    c = bpy.data.curves.new(name, 'FONT')
    c.body = text
    c.align_x = align
    c.size = size
    c.font = display_font if 'title' in name.lower() else label_font
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

# CABINET. Manufactured arcade cabinet. Blender -Y is front / glTF +Z.
before = set(bpy.context.scene.objects)
for x in [-1.46, 1.46]:
    for y in [-.94, .94]:
        cylinder('Levelling foot', (x,y,.065), .105, .10, dark)
box('Steel plinth', (0,0,.17), (3.65,2.73,.20), dark, .035)
box('Plinth chrome edge', (0,0,.283), (3.6,2.68,.035), chrome, .012)
body = box('Red lower cabinet', (0,0,.66), (3.48,2.53,.76), coral, .065)
# A real opening connects the upper hopper to the prize outlet.
for name, loc, dimensions in [
    ('Hopper shaft', (-.98,-.535,.97),(1.18,1.31,1.32)),
    ('Prize outlet opening', (-.98,-1.2,.65),(1.14,.66,.64)),
]:
    cutter=box(name,loc,dimensions,dark,0)
    modifier=body.modifiers.new(name,'BOOLEAN');modifier.operation='DIFFERENCE';modifier.object=cutter
    bpy.context.view_layer.objects.active=body
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
platform=box('Prize bed',(0,0,1.105),(3.3,2.36,.14),bed,.025)
cutter=box('Hopper platform cut',(-.98,-.535,1.11),(1.18,1.31,.4),dark,0)
modifier=platform.modifiers.new('Open collection hopper','BOOLEAN');modifier.operation='DIFFERENCE';modifier.object=cutter
bpy.context.view_layer.objects.active=platform;bpy.ops.object.modifier_apply(modifier=modifier.name)
bpy.data.objects.remove(cutter,do_unlink=True)
for x in [-1.57,-.39]:
    box('Hopper lip side',(x,-.535,1.19),(.025,1.31,.025),chrome,.006)
box('Hopper lip rear',(-.98,.12,1.19),(1.18,.025,.025),chrome,.006)
box('Back steel wall', (0,1.19,2.49), (3.42,.10,2.72), dark, .025)
box('Back graphic panel', (0,1.124,2.52), (3.12,.022,2.43), backdrop, .02)
# Keep the claw silhouette against a quiet, light interior. Branding sits high
# on the back panel, out of the prize and finger contact area.
label('Back brand title', 'coderpush.', (0,1.092,3.48), .24, dark)
label('Back subtitle', 'PICK A LITTLE HAPPINESS', (0,1.091,3.33), .075, dark)
for x in [-1.65,1.65]:
    for y in [-1.18,1.18]:
        box('Extruded aluminium upright',(x,y,2.5),(.145,.145,2.89),chrome,.022)
        box('White upright cover',(x,y-.078,2.5),(.114,.018,2.87),cream,.014)
        box('Vertical LED lens',(x,y-.094,2.5),(.035,.022,2.65),red_light if y<0 else light,.009)
box('Front white sill',(0,-1.22,1.19),(3.48,.18,.18),cream,.04)
box('Front red pinstripe',(0,-1.321,1.19),(3.31,.015,.039),coral,.006)
box('Rear sill',(0,1.21,1.21),(3.4,.12,.14),cream,.025)
box('Roof steel rim',(0,0,3.94),(3.64,2.7,.16),chrome,.035)
box('White roof',(0,0,4.09),(3.7,2.76,.25),cream,.065)
box('Red roof insert',(0,.03,4.225),(3.27,2.25,.036),coral,.02)
# Marquee is a deep lightbox, not a thin printed nameplate.
box('Marquee chrome surround',(0,-1.37,4.12),(3.71,.22,.68),chrome,.065)
box('Marquee black gasket',(0,-1.498,4.12),(3.59,.055,.58),dark,.047)
box('Marquee red lightbox',(0,-1.535,4.12),(3.47,.045,.50),coral,.036)
label('Marquee title shadow','CLOUD CLAW',(0.015,-1.566,3.955),.39,dark)
label('Marquee title','CLOUD CLAW',(0,-1.581,3.976),.39,sign_ink)
for x in [-1.59,1.59]:
    vertices=[(x,-1.584,4.12)]
    for i in range(10):
        angle=math.pi/2+i*math.pi/5
        radius=.087 if i%2==0 else .040
        vertices.append((x+math.cos(angle)*radius,-1.584,4.12+math.sin(angle)*radius))
    mesh=bpy.data.meshes.new('Marquee star mesh')
    mesh.from_pydata(vertices,[],[(0,i+1,(i+1)%10+1) for i in range(10)])
    star=bpy.data.objects.new('Marquee enamel star',mesh)
    bpy.context.collection.objects.link(star);assign(star,gold_light)
for x in [i*.20 for i in range(-8,9)]:
    for z in [3.872,4.368]:
        ellipsoid('Marquee incandescent lens',(x,-1.577,z),(.024,.018,.024),gold_light,12,8)
for x in [-1.4,1.4]:
    for y in [-.94,.94]:
        ellipsoid('Recessed warm light', (x,y,3.797), (.07,.07,.015), light,24,12)
# Glass door hardware and a real control shelf on the machine.
for z in [1.46,3.46]:
    box('Door hinge',(1.56,-1.285,z),(.065,.050,.18),chrome,.015)
box('Door latch',(-1.48,-1.282,2.26),(.06,.045,.22),chrome,.014)
box('Control shelf black edge',(.61,-1.45,1.065),(1.77,.61,.14),dark,.055)
box('Control shelf enamel',(.61,-1.46,1.144),(1.70,.56,.036),cream,.025)
cylinder('Joystick chrome washer',(.20,-1.48,1.18),.135,.026,chrome)
cylinder('Joystick rubber boot',(.20,-1.48,1.205),.080,.058,dark)
stick=group('Cabinet_joystick');stick.location=(.20,-1.48,1.21)
cylinder('Joystick steel shaft',(0,0,.11),.023,.22,chrome).parent=stick
ellipsoid('Joystick red ball',(0,0,.26),(.109,.109,.109),coral).parent=stick
cylinder('Drop button bezel',(1.08,-1.48,1.195),.148,.072,chrome)
cylinder('Cabinet_drop_button',(1.08,-1.48,1.246),.121,.055,coral)
# Chute, lockable service panel, speaker grille and coin mechanism.
# The outlet is open into the shaft; no decorative plane blocks the prize path.
box('Prize chute inner tray', (-.98,-1.775,.33), (1.14,1.31,.045), chrome, .022)
for x in [-1.54,-.38]:
    box('Outlet stainless frame',(x,-1.288,.65),(.045,.039,.68),chrome,.012)
box('Outlet stainless header',(-.98,-1.288,.99),(1.19,.039,.045),chrome,.012)
label('Chute label', 'PRIZE OUT', (-.98,-1.303,.282), .068, cream)
box('Service hatch',(.74,-1.281,.64),(1.50,.028,.62),dark,.025)
box('Service hatch face',(.74,-1.301,.64),(1.42,.018,.54),coral,.017)
box('Coin acceptor chrome',(.37,-1.322,.69),(.26,.026,.35),chrome,.012)
box('Coin acceptor black inset',(.37,-1.338,.73),(.13,.018,.19),dark,.004)
box('Coin slot',(.37,-1.352,.75),(.016,.015,.11),chrome,.001)
box('Credit display black',(.96,-1.326,.76),(.64,.02,.19),dark,.014)
label('Credit display','FREE PLAY',(.96,-1.344,.704),.099,gold_light)
for x in range(7):
    for z in range(3):
        hole=cylinder('Speaker grille perforation',(.79+x*.048,-1.328,.50+z*.041),.012,.013,dark,8)
        hole.rotation_euler[0]=math.pi/2
lock=cylinder('Service lock',(1.35,-1.33,.56),.025,.014,chrome,16)
lock.rotation_euler[0]=math.pi/2
for x in [-1.49,1.49]:
    for z in [.32,.99]:
        screw = cylinder('Cabinet screw', (x,-1.27,z), .023,.012,chrome,16)
        screw.rotation_euler[0]=math.pi/2
# White side graphics are inset beneath the red enamel body edges.
for x in [-1.747,1.747]:
    box('Side graphic white band',(x,.08,.64),(.008,2.1,.18),cream,.0)
    box('Side graphic black accent',(x,-.1,.45),(.009,1.68,.052),dark,.0)
# More vertical clearance lets the complete toy rise above the pile before
# horizontal travel. Do not fake this by shrinking the prize in flight.
for o in [o for o in bpy.context.scene.objects if o not in before]:
    if o.location.z>=3.75:
        o.location.z+=.5
    elif o.name.startswith(('Extruded aluminium upright','White upright cover','Vertical LED lens','Back steel wall')):
        o.location.z+=.25;o.dimensions.z+=.5
    elif o.name.startswith('Door hinge') and o.location.z>3:
        o.location.z+=.5
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
# The missing arc already faces -Y. Keep it there so the upright browser
# display has a downward opening, matching the real travel pillow.
emb=label('Pillow embroidery','coderpush.',(0,.21,.327),.10,black)
emb.rotation_euler=(0,0,0);emb.parent=pillow
pillow_objects=export('pillow',before)

# CLAW. Hub and three jointed steel fingers with curved rubber tips.
before=set(bpy.context.scene.objects)
claw=group('Claw')
cylinder('Claw shoulder',(0,0,0),.18,.20,claw_steel)
cylinder('Claw coral ring',(0,0,-.09),.194,.06,coral)
ellipsoid('Claw dome',(0,0,.095),(.178,.178,.11),claw_steel)
cylinder('Cable socket',(0,0,.22),.051,.14,dark)
for i in range(3):
    angle=i*math.tau/3
    pivot=group('Finger_'+str(i))
    pivot.location=(0,0,-.08)
    pivot.rotation_euler[2]=angle
    arm=tube('Finger steel_'+str(i),[(.13,0,0),(.29,0,-.22),(.40,0,-.48),(.30,0,-.66),(.15,0,-.72)],.031,claw_steel)
    arm.parent=pivot
    pad=tube('Rubber grip_'+str(i),[(.32,-.002,-.637),(.25,-.002,-.694),(.15,-.002,-.72)],.039,dark)
    pad.parent=pivot
    knuckle=ellipsoid('Finger joint_'+str(i),(.155,0,-.02),(.055,.065,.055),claw_steel,24,12);knuckle.parent=pivot
for o in list(bpy.context.scene.objects):
    if o not in before and o!=claw and not o.parent:o.parent=claw
claw_objects=export('claw',before)

# Match the browser's shared assortment and floor-aligned poses.
with open(os.path.join(ROOT,'src','prize-layout.json')) as layout_file:
    layout=json.load(layout_file)
used=set()
for data in layout:
    original,objects=(bunny,bunny_objects) if data['kind']=='bunny' else (pillow,pillow_objects)
    if data['kind'] not in used:
        root=original;items=objects;used.add(data['kind'])
    else:
        lookup={}
        for source in objects:
            duplicate=source.copy()
            if source.data:duplicate.data=source.data
            bpy.context.collection.objects.link(duplicate);lookup[source]=duplicate
        for source,duplicate in lookup.items():duplicate.parent=lookup.get(source.parent)
        root=lookup[original];items=list(lookup.values())
    rx=(math.pi/2 if data.get('upright') else 0)+data.get('lean',0)
    qg=Quaternion((1,0,0),rx) @ Quaternion((0,1,0),data.get('angle',0)) @ Quaternion((0,0,1),data.get('roll',0))
    basis=Quaternion((1,0,0),math.pi/2)
    root.rotation_mode='QUATERNION';root.rotation_quaternion=basis @ qg @ basis.inverted()
    root.scale=(data['scale'],)*3;root.location=(data['x'],-data['z'],0)
    bpy.context.view_layer.update()
    bottom=min((o.matrix_world @ v.co).z for o in items if o.type=='MESH' for v in o.data.vertices)
    root.location.z=1.196-bottom
claw.location=(-.4,.15,3.78);claw.scale=(.65,)*3
for i in range(3):bpy.data.objects['Finger_'+str(i)].rotation_euler.y=-.45

# Presentation elements are saved in Blender but do not enter the asset exports.
glass=material('Presentation glass','#daeaff',0,.055)
glass.node_tree.nodes.get('Principled BSDF').inputs['Transmission Weight'].default_value=1
glass.node_tree.nodes.get('Principled BSDF').inputs['IOR'].default_value=1.45
for x in [-1.66,1.66]:
    box('Glass side display',(x,0,2.74),(.008,2.25,3.06),glass,.001)
box('Glass front display',(0,-1.186,2.79),(3.15,.008,3.00),glass,.001)
floor_mat=material('Dark arcade floor','#222c28',0,.95)
box('Presentation floor',(0,0,-.026),(200,200,.05),floor_mat,0)
for x in [-1.37,1.37]:
    box('Crane running rail',(x,0,4.19),(.06,2.1,.06),chrome,.006)
box('Crane crossbar',(0,.15,4.14),(2.92,.12,.09),chrome,.008)
box('Crane carriage',(-.4,.15,4.08),(.40,.35,.13),dark,.025)
cylinder('Crane cable',(-.4,.15,4.095),.016,.07,dark,12)
bpy.ops.object.camera_add(location=(4.6,-9.4,4.2))
camera=bpy.context.object;camera.name='Art direction camera'
camera.rotation_euler=(Vector((0,0,2.30))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='PERSP';camera.data.lens=43
bpy.context.scene.camera=camera
for loc,energy,size in [((1,-4,7),900,5),((-5,-1,5),500,4),((2,4,6),650,4)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    l=bpy.context.object;l.data.energy=energy;l.data.shape='DISK';l.data.size=size
    l.rotation_euler=(Vector((0,0,2))-l.location).to_track_quat('-Z','Y').to_euler()
for loc,power,rgb in [((-2,-2,1.5),15,(1,.22,.10)),((3,0,2.8),20,(.45,.65,1))]:
    bpy.ops.object.light_add(type='POINT',location=loc)
    bpy.context.object.data.energy=power;bpy.context.object.data.color=rgb
bpy.context.scene.world.use_nodes=True
background=bpy.context.scene.world.node_tree.nodes.get('Background')
background.inputs['Color'].default_value=color('#131a28')
background.inputs['Strength'].default_value=.35
bpy.context.scene.render.engine='CYCLES'
bpy.context.scene.cycles.samples=32
bpy.context.scene.cycles.use_denoising=True
bpy.context.scene.render.resolution_x=1440
bpy.context.scene.render.resolution_y=1100
bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.film_transparent=False
bpy.context.scene.render.filepath=os.path.join(ROOT,'art','arcade-preview.png')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.overlay.show_overlays=False
            area.spaces.active.shading.type='MATERIAL'
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'art','cloud-claw.blend'))
if '--render-preview' in sys.argv:
    bpy.ops.render.render(write_still=True)
print('Cloud Claw assets created: cabinet, bunny, pillow, claw and editable Blender scene.')
