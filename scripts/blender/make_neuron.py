"""
Headless Blender script: generates the LATENT hero neuron -> public/models/neuron.glb

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python scripts/blender/make_neuron.py [-- seed=7 preview=1]

A pyramidal neuron: a displaced soma, a long apical dendrite with a branching tuft, basal dendrites,
and a myelinated axon that ends in branching terminals with boutons. Geometry is swept directly with
bmesh (parallel-transport frames), so every vertex knows exactly where it sits on the cell.

Vertex colour COLOR_0 (linear, float) encodes data for the web shader, not colour:
  R = path distance from the soma, normalised per compartment (dendrites 0..1, axon 0..1)
  G = branch id hash 0..1 (lets the shader fire individual branches)
  B = compartment: 0.0 soma · 0.5 dendrite · 1.0 axon (myelin and boutons included)
  A = 1

Axes: glTF +Y up. Soma at origin, apical dendrite toward +Y, axon toward −Y and slightly +X.
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix, noise

ARGS = dict(a.split('=') for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []))
SEED = int(ARGS.get('seed', 7))
PREVIEW = ARGS.get('preview', '1') == '1'
random.seed(SEED)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'models', 'neuron.glb')
SCRATCH = os.environ.get('LATENT_SCRATCH', os.path.join(ROOT, '..', 'shots-latent', 'blender'))
os.makedirs(SCRATCH, exist_ok=True)

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)

bm = bmesh.new()
col_layer = bm.loops.layers.float_color.new('Col')  # filled per-loop from per-vertex data
vdata = {}  # vert -> (r, g, b)

RING = 10  # verts per ring


def frames(points):
    """Parallel-transport frames along a polyline."""
    tangents = []
    for i in range(len(points)):
        a = points[max(0, i - 1)]
        b = points[min(len(points) - 1, i + 1)]
        tangents.append((b - a).normalized())
    t0 = tangents[0]
    up = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    n = t0.cross(up).normalized()
    out = []
    for t in tangents:
        n = (n - t * n.dot(t)).normalized()
        out.append((t, n, t.cross(n).normalized()))
    return out


def sweep(points, radii, dists, branch_id, comp, cap_end=True):
    """Sweep a tube along points with per-point radius; dists = normalised path distance per point."""
    fr = frames(points)
    rings = []
    for p, r, (t, n, b) in zip(points, radii, fr):
        ring = []
        for k in range(RING):
            a = 2 * math.pi * k / RING
            v = bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * r)
            ring.append(v)
        rings.append(ring)
    for ring, d in zip(rings, dists):
        for v in ring:
            vdata[v] = (d, branch_id, comp)
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(RING):
            k2 = (k + 1) % RING
            bm.faces.new((A[k], A[k2], B[k2], B[k]))
    if cap_end:
        tip = bm.verts.new(points[-1] + fr[-1][0] * radii[-1] * 0.8)
        vdata[tip] = (dists[-1], branch_id, comp)
        last = rings[-1]
        for k in range(RING):
            bm.faces.new((last[k], last[(k + 1) % RING], tip))


def wander(start, direction, length, steps, jitter, gravity=Vector((0, 0, 0)), seed=0.0):
    """A smooth organic path: direction perturbed by 3D noise."""
    pts = [start.copy()]
    d = direction.normalized()
    seg = length / steps
    p = start.copy()
    for i in range(steps):
        q = p * 1.7 + Vector((seed, seed * 0.37, seed * 1.3))
        d = (d + noise.noise_vector(q) * jitter + gravity).normalized()
        p = p + d * seg
        pts.append(p.copy())
    return pts


# ---------------------------------------------------------------- dendrites (recursive)
dendrite_paths = []  # (points, r0, r1, start_dist, branch_id)


def grow(start, direction, length, r0, depth, start_dist, branch_id, tuft=False):
    steps = max(6, int(length * 22))
    pts = wander(start, direction, length, steps, 0.22 + depth * 0.04, seed=random.random() * 100)
    r1 = max(0.0035, r0 * (0.6 if depth < 2 else 0.42))
    dendrite_paths.append((pts, r0, r1, start_dist, branch_id))
    end_dist = start_dist + length
    if depth >= (5 if tuft else 4):
        return
    nkids = 2 if random.random() < 0.75 else 3
    # branch points along the last half of the segment
    for c in range(nkids):
        at = random.randint(int(len(pts) * 0.55), len(pts) - 1)
        base = pts[at]
        tangent = (pts[min(at + 1, len(pts) - 1)] - pts[max(at - 1, 0)]).normalized()
        side = tangent.orthogonal().normalized()
        side.rotate(Matrix.Rotation(random.uniform(0, 2 * math.pi), 3, tangent))
        ang = random.uniform(0.45, 0.95)
        newdir = (tangent * math.cos(ang) + side * math.sin(ang)).normalized()
        frac = at / (len(pts) - 1)
        grow(base, newdir, length * random.uniform(0.5, 0.72), r1 * 1.02, depth + 1,
             start_dist + length * frac, (branch_id + (c - (nkids - 1) / 2) * 0.03 / (depth + 1)) % 1.0, tuft)


SOMA_R = 0.32
# apical dendrite: long, up, with a tuft
grow(Vector((0, SOMA_R * 0.8, 0)), Vector((0.08, 1, 0.05)), 2.2, 0.085, 0, 0.0, 0.07, tuft=True)
# basal dendrites: radiate around the lower/side hemisphere
NB = 8
for i in range(NB):
    a = 2 * math.pi * i / NB + random.uniform(-0.3, 0.3)
    d = Vector((math.cos(a), random.uniform(-0.55, 0.15), math.sin(a))).normalized()
    grow(d * SOMA_R * 0.85, d, random.uniform(1.0, 1.45), 0.055, 1, 0.0, (i + 1) / (NB + 1.3))

max_d = max(sd + (len(p) - 1) * 0 + (p[-1] - p[0]).length + 0.0001 for p, _, _, sd, _ in dendrite_paths)
max_d = 0.0
for pts, r0, r1, sd, bid in dendrite_paths:
    L = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))
    max_d = max(max_d, sd + L)

for pts, r0, r1, sd, bid in dendrite_paths:
    n = len(pts)
    acc = [0.0]
    for i in range(n - 1):
        acc.append(acc[-1] + (pts[i + 1] - pts[i]).length)
    L = acc[-1]
    radii = [r0 + (r1 - r0) * (s / L) ** 0.8 for s in acc]
    # small spine bumps
    radii = [r * (1 + 0.12 * math.sin(s * 40 + bid * 50)) for r, s in zip(radii, acc)]
    dists = [(sd + s) / max_d for s in acc]
    sweep(pts, radii, dists, bid, 0.5)

# ---------------------------------------------------------------- axon
axon_pts = wander(Vector((0, -SOMA_R * 0.8, 0)), Vector((0.35, -1, 0.1)), 3.4, 90, 0.08,
                  gravity=Vector((0.004, -0.002, 0)), seed=3.3)
acc = [0.0]
for i in range(len(axon_pts) - 1):
    acc.append(acc[-1] + (axon_pts[i + 1] - axon_pts[i]).length)
AX_L = acc[-1]
terminal_paths = []
# terminals: a fan of small branches at the end
end = axon_pts[-1]
tan = (axon_pts[-1] - axon_pts[-4]).normalized()
for k in range(7):
    side = tan.orthogonal().normalized()
    side.rotate(Matrix.Rotation(2 * math.pi * k / 7 + random.uniform(-.2, .2), 3, tan))
    d = (tan * 0.7 + side * random.uniform(0.6, 1.0)).normalized()
    terminal_paths.append(wander(end, d, random.uniform(0.35, 0.6), 14, 0.35, seed=k * 9.1))
AX_TOTAL = AX_L + 0.6

# axon shaft with hillock taper
radii = []
for s in acc:
    hill = 0.07 * math.exp(-s * 9)            # axon hillock flare
    radii.append(0.026 + hill)
sweep(axon_pts, radii, [s / AX_TOTAL for s in acc], 0.93, 1.0)

# myelin sheaths: fat capsules with gaps (nodes of Ranvier)
s_cursor = 0.35
while s_cursor < AX_L - 0.35:
    seg_len = 0.26
    i0 = next(i for i, s in enumerate(acc) if s >= s_cursor)
    i1 = next((i for i, s in enumerate(acc) if s >= s_cursor + seg_len), len(acc) - 1)
    pts = axon_pts[i0:i1 + 1]
    if len(pts) >= 3:
        m = len(pts)
        rr = [0.026 + 0.034 * math.sin(math.pi * (j / (m - 1))) ** 0.45 for j in range(m)]
        sweep(pts, rr, [acc[i0 + j] / AX_TOTAL for j in range(m)], 0.95, 1.0)
    s_cursor += seg_len + 0.05

for k, pts in enumerate(terminal_paths):
    n = len(pts)
    a2 = [0.0]
    for i in range(n - 1):
        a2.append(a2[-1] + (pts[i + 1] - pts[i]).length)
    rr = [0.016 - 0.008 * (s / a2[-1]) for s in a2]
    ds = [(AX_L + s) / AX_TOTAL for s in a2]
    sweep(pts, rr, ds, (0.4 + k * 0.083) % 1.0, 1.0)
    # bouton
    res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.042,
                                     matrix=Matrix.Translation(pts[-1]))
    for v in res['verts']:
        vdata[v] = (min(1.0, ds[-1] + 0.02), (0.4 + k * 0.083) % 1.0, 1.0)

# ---------------------------------------------------------------- soma
res = bmesh.ops.create_icosphere(bm, subdivisions=5, radius=SOMA_R)
for v in res['verts']:
    p = v.co
    # pyramidal: stretch up, pinch toward the apical dendrite, organic noise
    p.y *= 1.18
    if p.y > 0:
        k = p.y / (SOMA_R * 1.18)
        p.x *= 1 - 0.35 * k
        p.z *= 1 - 0.35 * k
    p += p.normalized() * noise.noise(p * 3.1) * 0.035
    vdata[v] = (0.0, 0.5, 0.0)

# ---------------------------------------------------------------- write colours, build object
for f in bm.faces:
    f.smooth = True
    for loop in f.loops:
        r, g, b = vdata.get(loop.vert, (0.0, 0.0, 0.5))
        loop[col_layer] = (r, g, b, 1.0)

me = bpy.data.meshes.new('Neuron')
bm.to_mesh(me)
bm.free()
obj = bpy.data.objects.new('Neuron', me)
bpy.context.collection.objects.link(obj)
# Blender 4.1+: smooth via auto-smooth-free shading
for p in me.polygons:
    p.use_smooth = True
me.color_attributes.active_color = me.color_attributes['Col']
me.color_attributes.render_color_index = 0

# a material that *uses* the colour attribute, so every exporter mode keeps it
mat = bpy.data.materials.new('NeuronData')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes.get('Principled BSDF')
attr = nt.nodes.new('ShaderNodeVertexColor')
attr.layer_name = 'Col'
nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
me.materials.append(mat)

print('verts', len(me.vertices), 'tris', sum(len(p.vertices) - 2 for p in me.polygons))

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
os.makedirs(os.path.dirname(OUT), exist_ok=True)
kw = dict(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
          export_normals=True, export_texcoords=False, export_materials='EXPORT')
try:
    bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE', export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
                              export_draco_normal_quantization=10, export_draco_color_quantization=12)
    print('exported (draco)', OUT)
except Exception as e:
    print('draco export failed, plain export:', e)
    bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    print('exported (plain)', OUT)

# ---------------------------------------------------------------- preview render
if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    world = bpy.data.worlds.new('W'); scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.004, 0.004, 0.006, 1)
    # preview material: glossy graphite + emission driven by distance bands
    pm = bpy.data.materials.new('Preview'); pm.use_nodes = True
    n = pm.node_tree; b = n.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.02, 0.022, 0.03, 1)
    b.inputs['Roughness'].default_value = 0.25
    vc = n.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    sep = n.nodes.new('ShaderNodeSeparateColor')
    n.links.new(vc.outputs['Color'], sep.inputs['Color'])
    math1 = n.nodes.new('ShaderNodeMath'); math1.operation = 'SINE'
    mul = n.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 40
    n.links.new(sep.outputs['Red'], mul.inputs[0]); n.links.new(mul.outputs[0], math1.inputs[0])
    pw = n.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 12
    n.links.new(math1.outputs[0], pw.inputs[0])
    n.links.new(pw.outputs[0], b.inputs['Emission Strength'])
    b.inputs['Emission Color'].default_value = (1.0, 0.18, 0.05, 1)
    obj.data.materials[0] = pm
    for loc, energy, color in [((4, 3, 5), 900, (0.66, 0.94, 1.0)), ((-5, -2, 3), 500, (0.36, 0.48, 0.98)), ((0, 5, -4), 700, (1, 1, 1))]:
        ld = bpy.data.lights.new('L', 'AREA'); ld.energy = energy; ld.color = color; ld.size = 3
        lo = bpy.data.objects.new('L', ld); lo.location = loc; scene.collection.objects.link(lo)
        lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('C'); cd.lens = 50
    co = bpy.data.objects.new('C', cd); scene.collection.objects.link(co); scene.camera = co
    co.location = (2.6, 0.2, 6.5)
    co.rotation_euler = (Vector((0.3, 0.1, 0)) - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(SCRATCH, 'neuron_preview.png')
    bpy.ops.render.render(write_still=True)
    print('preview', scene.render.filepath)
