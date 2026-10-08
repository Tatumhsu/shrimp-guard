import bpy, math, random, os
from mathutils import Vector
random.seed(12)
OUT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(n,c,metal=0):
 m=bpy.data.materials.new(n); m.diffuse_color=(*c,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1); p.inputs['Roughness'].default_value=.38; p.inputs['Metallic'].default_value=metal
 return m
cream=mat('Warm porcelain',(.86,.80,.66)); white=mat('Ivory',(.97,.95,.85)); teal=mat('Lagoon',(.10,.42,.40)); mint=mat('Sage',(.35,.62,.49)); coral=mat('Terracotta',(.78,.29,.17)); gold=mat('Brass',(.83,.57,.21),.5); dark=mat('Ink',(.055,.13,.17)); blue=mat('Water',(.19,.52,.65)); wood=mat('Oak',(.48,.27,.12)); pink=mat('Rose',(.82,.56,.43))
def cube(n,p,s,m,bevel=.07):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p); o=bpy.context.object;o.name=n;o.dimensions=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel: mod=o.modifiers.new('Soft crafted edges','BEVEL');mod.width=bevel;mod.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o
def sphere(n,p,s,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=p);o=bpy.context.object;o.name=n;o.scale=s;o.data.materials.append(m);bpy.ops.object.shade_smooth();return o
def cyl(n,p,r,d,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=d,location=p);o=bpy.context.object;o.name=n;o.data.materials.append(m);b=o.modifiers.new('Rounded rim','BEVEL');b.width=.05;b.segments=3;o.modifiers.new('Normals','WEIGHTED_NORMAL');return o
def line(n,pts,m,r=.025):
 c=bpy.data.curves.new(n,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=3;s=c.splines.new('POLY');s.points.add(len(pts)-1)
 for p,v in zip(s.points,pts):p.co=(*v,1)
 o=bpy.data.objects.new(n,c);bpy.context.collection.objects.link(o);o.data.materials.append(m);return o
def tree(x,y,z=.45):
 cyl('Tree trunk',(x,y,z+.25),.055,.55,wood);sphere('Sculpted canopy',(x,y,z+.65),(.30,.27,.4),mint)
# central daily-life cutaway: distinct room and objects, not a stock globe
cyl('Central life island',(0,0,0),2.1,.36,cream);cyl('Garden rim',(0,0,.2),1.96,.09,mint)
cube('Oak floor',(0,0,.32),(2.65,2.1,.15),wood)
for x in [-1.1,-.8,-.5,-.2,.1,.4,.7,1]:cube('Floor plank',(x,0,.41),(.014,2,.015),cream,.002)
cube('Back wall',(0,.98,1.13),(2.65,.12,1.6),white);cube('Side wall',(-1.27,0,1.13),(.12,2,1.6),cream)
cube('Window frame',(.36,.89,1.35),(1.1,.08,.8),wood);cube('Window glass',(.36,.83,1.35),(.98,.025,.68),blue)
cube('Window cross',(.36,.8,1.35),(.045,.04,.72),white);cube('Window cross',(.36,.8,1.35),(1,.04,.04),white)
cube('Sofa base',(-.6,.15,.65),(.8,1.15,.35),coral);cube('Sofa back',(-.98,.15,.88),(.18,1.15,.65),coral)
for y in [-.4,.7]:cube('Sofa arm',(-.6,y,.85),(.8,.16,.45),pink)
for y in [-.12,.32]:cube('Cushion',(-.53,y,.86),(.53,.39,.16),pink)
cyl('Round rug',(.4,-.35,.44),.63,.02,cream);cyl('Coffee table',(.4,-.35,.7),.39,.07,white);cyl('Table leg',(.4,-.35,.56),.08,.27,gold)
cube('Book',(.35,-.4,.76),(.25,.18,.035),teal);cyl('Cup',(.57,-.25,.8),.055,.10,coral)
cube('Work desk',(.67,.55,.9),(.9,.5,.08),wood)
for x in [.3,1]:cyl('Desk leg',(x,.6,.66),.035,.5,dark)
cube('Laptop',(.65,.55,1.1),(.43,.035,.29),dark);cube('Laptop screen',(.65,.52,1.1),(.36,.015,.22),blue)
sphere('Person head',(.8,-.8,1.06),(.13,.13,.14),pink);sphere('Person hair',(.8,-.76,1.14),(.14,.13,.075),dark)
cube('Person sweater',(.8,-.8,.79),(.24,.19,.32),teal)
for x in [.73,.87]:cube('Person legs',(x,-.8,.55),(.08,.09,.23),dark)
for x,y in [(-1.55,.5),(1.55,.45),(-.6,-1.55)]:tree(x,y,.28)
# orbit paths link the everyday scene to miniature event worlds
for rad in [2.65,3.9]:line('Orbital connection',[(rad*math.cos(a*math.tau/160),rad*math.sin(a*math.tau/160),.12) for a in range(161)],gold,.013)
for i,(x,y) in enumerate([(-3.3,-1.3),(2.9,1.7),(-1,3.3)]):
 cyl('Event island '+str(i),(x,y,.05),1.08,.3,cream);cyl('Surface',(x,y,.23),1.01,.06,blue if i==0 else mint)
 line('Impact thread',[(x,y,.26),(x*.7,y*.7,.65),(x*.37,y*.37,.4)],gold)
 if i==0:
  cube('Container ship hull',(x,y,.47),(1.5,.55,.28),dark);cube('Bridge',(x-.5,y,.73),(.28,.46,.3),white)
  for a in range(3):
   for b in range(2):cube('Cargo container',(x-.15+a*.34,y-.14+b*.28,.7),(.30,.23,.24),[coral,gold,teal][a])
  for a in [-.5,0,.5]:line('Water ripple',[(x+a-.2,y-.6,.29),(x+a+.2,y-.6,.29)],white,.017)
 elif i==1:
  for a in [-.4,0,.4]:
   cube('Cloud service tower',(x+a,y,.73),(.3,.55,.95),dark)
   for z in [.4,.58,.76,.94]:cube('Service status',(x+a,y-.29,z),(.2,.025,.045),mint)
  for a in [-.25,0,.25]:sphere('Cloud',(x+a,y,1.5),(.3,.22,.2),white)
 else:
  cube('Terminal',(x,y,.5),(1.3,.55,.4),white);cube('Terminal glazing',(x,y-.29,.51),(1.15,.03,.25),blue)
  cube('Aircraft fuselage',(x,y-.45,.89),(.13,.85,.15),white);o=cube('Aircraft wings',(x,y-.45,.88),(.8,.22,.07),white);o.rotation_euler[2]=-.18
  cube('Aircraft tail',(x,y-.1,1.02),(.06,.17,.3),coral)
for x,y in [(3,-1.5),(-3,1.4),(1.3,-2.8)]:
 cyl('Small garden',(x,y,0),.48,.20,cream);tree(x,y,.1)
scene=bpy.context.scene;scene.world.color=(.3,.3,.3)
bpy.ops.object.camera_add(location=(8,-12,10));cam=bpy.context.object;cam.rotation_euler=(Vector((0,.3,.3))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=10.8;scene.camera=cam
for p,power,size in [((1,-5,9),1800,7),((-5,1,6),1200,5),((4,5,7),1600,4)]:
 bpy.ops.object.light_add(type='AREA',location=p);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1400;scene.render.resolution_y=1200;scene.render.resolution_percentage=100;scene.render.film_transparent=True
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=OUT+'/assets/world.png'
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/source/world.blend')
bpy.ops.export_scene.gltf(filepath=OUT+'/assets/world.glb',export_format='GLB',export_cameras=False,export_lights=False,export_apply=True)
bpy.ops.render.render(write_still=True)
print('WORLD_IMPACT_BLENDER_COMPLETE',bpy.app.version_string)
