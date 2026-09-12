"""Directional projection of evaluated character geometry onto a flat ground receiver."""
import bpy
from mathutils import Vector


class GroundShadow:
    def __init__(self):
        scene = bpy.context.scene
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'FLAT'
        scene.display.shading.color_type = 'SINGLE'
        scene.display.shading.single_color = (0, 0, 0)
        scene.display.shading.show_shadows = False
        scene.display.shading.show_cavity = False
        scene.display.shading.show_specular_highlight = False
        scene.display.shading.show_object_outline = False
        # Widen the receiver view at unchanged pixels per metre; raised tools can extend beyond the body camera.
        scene.camera.data.ortho_scale *= 1.5
        scene.render.resolution_x = round(scene.render.resolution_x * 1.5)
        scene.render.resolution_y = round(scene.render.resolution_y * 1.5)
        self.casters = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render]
        self.projected = []
        self.material = bpy.data.materials.new('GroundShadow')
        self.material.use_nodes = True
        nodes = self.material.node_tree.nodes
        nodes.clear()
        emission = nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (0, 0, 0, 1)
        output = nodes.new('ShaderNodeOutputMaterial')
        self.material.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])

    def update(self):
        for obj in self.projected:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)
        self.projected = []
        graph = bpy.context.evaluated_depsgraph_get()
        # Artistic daylight: world +X/-Y casts toward screen lower-right; independent of facing.
        ray = Vector((0.65, -0.75, -1))
        for caster in self.casters:
            evaluated = caster.evaluated_get(graph)
            mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=graph)
            matrix = evaluated.matrix_world
            for vertex in mesh.vertices:
                point = matrix @ vertex.co
                vertex.co = point + ray * max(0, point.z)
                vertex.co.z = 0
            mesh.materials.clear()
            mesh.materials.append(self.material)
            for polygon in mesh.polygons:
                polygon.material_index = 0
            obj = bpy.data.objects.new('ProjectedShadow', mesh)
            bpy.context.scene.collection.objects.link(obj)
            self.projected.append(obj)
            caster.hide_render = True
