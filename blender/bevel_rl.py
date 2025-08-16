import bpy
import bmesh
from mathutils import Vector

bl_info = {
    "name": "Bevel RL",
    "author": "Renan Lacerda / ChatGPT",
    "version": (1, 2),
    "blender": (2, 80, 0),
    "location": "View3D > Sidebar > Bevel RL",
    "description": "Bevel com profundidade extra e perfil customizado via curva",
    "category": "Mesh",
}

class BevelRL_OT_edge_bevel(bpy.types.Operator):
    bl_idname = "object.edge_bevel_custom"
    bl_label = "Aplicar Bevel"
    bl_options = {'REGISTER', 'UNDO'}

    segments: bpy.props.IntProperty(
        name="Segmentos",
        description="Número de segmentos para o bevel",
        default=2,
        min=1,
        max=10,
    )
    offset: bpy.props.FloatProperty(
        name="Largura Bevel",
        description="Distância do bevel",
        default=0.05,
        min=0.001,
        max=1.0,
        precision=3,
    )
    depth: bpy.props.FloatProperty(
        name="Profundidade Extra",
        description="Move a edge central no eixo do normal",
        default=0.0,
        min=-1.0,
        max=1.0,
        precision=3,
    )
    profile: bpy.props.FloatProperty(
        name="Profile",
        description="Formato da curva do deslocamento (superelipse)",
        default=1.0,
        min=0.1,
        max=3.0,
        precision=3,
    )

    def execute(self, context):
        obj = context.active_object
        if obj is None or obj.mode != 'EDIT':
            self.report({'WARNING'}, "O objeto ativo deve estar no modo de edição (Edit Mode)")
            return {'CANCELLED'}

        bm = bmesh.from_edit_mesh(obj.data)
        bm.normal_update()

        # Salva pontos médios originais
        original_midpoints = []
        for e in bm.edges:
            if e.select:
                mid = (e.verts[0].co + e.verts[1].co) / 2
                original_midpoints.append(mid.copy())

        # Aplica bevel
        bpy.ops.mesh.bevel(
            offset=self.offset,
            segments=self.segments,
            affect='EDGES',
            clamp_overlap=True,
        )

        if self.depth != 0 and original_midpoints:
            bm = bmesh.from_edit_mesh(obj.data)
            bm.normal_update()

            for mid in original_midpoints:
                # Encontra edges criadas pelo bevel
                all_edges = []
                for e in bm.edges:
                    edge_mid = (e.verts[0].co + e.verts[1].co) / 2
                    dist = (edge_mid - mid).length
                    if dist < self.offset * 1.5:
                        all_edges.append((e, dist))

                if not all_edges:
                    continue

                # Distância máxima para normalizar
                max_dist = max(d for _, d in all_edges) or 1e-6

                for e, dist in all_edges:
                    # Fator t (0 = borda, 1 = centro)
                    t = 1.0 - (dist / max_dist)
                    # Curva superelipse
                    influence = (1.0 - abs(1.0 - t) ** self.profile) ** (1.0 / self.profile)

                    if influence <= 0:
                        continue

                    normal = (e.verts[0].normal + e.verts[1].normal).normalized()
                    for v in e.verts:
                        v.co += normal * (self.depth * influence)

            bmesh.update_edit_mesh(obj.data)

        return {'FINISHED'}




class BevelRL_PT_panel(bpy.types.Panel):
    bl_label = "Bevel RL"
    bl_idname = "OBJECT_PT_bevel_rl"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Bevel RL"

    def draw(self, context):
        layout = self.layout
        props = context.scene.bevel_rl_props

        layout.prop(props, "segments")
        layout.prop(props, "offset")
        layout.prop(props, "depth")
        op = layout.operator("object.edge_bevel_custom", text="Aplicar Bevel")
        # passa valores do painel para o operador
        op.segments = props.segments
        op.offset = props.offset
        op.depth = props.depth


class BevelRL_Properties(bpy.types.PropertyGroup):
    segments: bpy.props.IntProperty(
        name="Segmentos",
        description="Número de segmentos para o bevel",
        default=2,
        min=1,
        max=10,
    )
    offset: bpy.props.FloatProperty(
        name="Largura Bevel",
        description="Distância do bevel",
        default=0.05,
        min=0.001,
        max=1.0,
        precision=3,
    )
    depth: bpy.props.FloatProperty(
        name="Profundidade Extra",
        description="Move a edge central no eixo do normal",
        default=0.0,
        min=-1.0,
        max=1.0,
        precision=3,
    )


def register():
    bpy.utils.register_class(BevelRL_OT_edge_bevel)
    bpy.utils.register_class(BevelRL_PT_panel)
    bpy.utils.register_class(BevelRL_Properties)
    bpy.types.Scene.bevel_rl_props = bpy.props.PointerProperty(type=BevelRL_Properties)


def unregister():
    bpy.utils.unregister_class(BevelRL_OT_edge_bevel)
    bpy.utils.unregister_class(BevelRL_PT_panel)
    bpy.utils.unregister_class(BevelRL_Properties)
    del bpy.types.Scene.bevel_rl_props


if __name__ == "__main__":
    register()
