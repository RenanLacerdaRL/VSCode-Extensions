bl_info = {
    "name": "QuickMenuRL",
    "author": "RenanLacerda/ChatGPT",
    "version": (1, 1),
    "blender": (2, 80, 0),
    "location": "Q key in 3D View",
    "description": "Popup menu com Wireframe e Mirror ao pressionar Q",
    "category": "3D View"
}

import bpy
import bmesh
import mathutils
from bpy.app.handlers import persistent 
from mathutils import Vector, Matrix

class QuickMenuRL_MT_main(bpy.types.Menu):
    bl_label = "QuickMenuRL"
    bl_idname = "QUICKMENURL_MT_main"

    def draw(self, context):
        if(bpy.context.space_data.type == 'VIEW_3D'):
            layout = self.layout
            layout.operator("object.toggle_wireframe", text="Show/Hide Wireframe", icon='SHADING_WIRE')
            layout.operator('object.toggle_measurement',text="Show/Hide Measurement", icon="DRIVER_DISTANCE")
            layout.operator('object.select_object_group',text="Select Object Group", icon="MESH_CUBE")
            layout.separator()
            layout.operator("object.set_pivot_to_cursor", text="Pivot to Cursor", icon="PIVOT_CURSOR")
            layout.operator("object.set_pivot_to_center", text="Pivot to Center", icon="PIVOT_MEDIAN")
            layout.operator("object.set_pivot_to_active", text="Pivot to Active", icon="PIVOT_ACTIVE")  
            layout.operator("object.set_pivot_to_object_center", text="Pivot to Object Center", icon="PIVOT_BOUNDBOX")
            layout.operator("object.set_pivot_to_object_point", text="Pivot to Object Point", icon="ORIENTATION_CURSOR")
            layout.separator()
            if(context.active_object.mode=='OBJECT'):
                layout.menu("VIEW3D_MT_object_apply", icon='MODIFIER')
                layout.menu("VIEW3D_MT_object_parent", icon='CONSTRAINT')
                layout.menu("VIEW3D_MT_make_links", icon='LINKED')
                layout.menu("VIEW3D_MT_make_single_user", icon='UNLINKED')
                layout.menu("VIEW3D_MT_mirror", icon='MOD_MIRROR')
                layout.menu("VIEW3D_MT_object_showhide", icon='HIDE_OFF')
                layout.separator()
                # layout.operator("object.join", icon="AUTOMERGE_ON", text="Join")
                # layout.operator("object.duplicate_move", icon="DUPLICATE", text="Duplicate")
                operation=layout.operator('object.convert',icon="OUTLINER_DATA_CURVE", text="Curve From Mesh/Text")
                operation.target='CURVE'
                operation=layout.operator('object.convert',icon="MESH_DATA", text="Mesh From Curve/Surf/Text")
                operation.target='MESH'
                layout.separator()
                layout.prop(context.tool_settings, "use_transform_data_origin", text="Set Origins")
                operation=layout.operator("object.origin_set",text="Origin to Center",icon="PIVOT_BOUNDBOX").type = 'ORIGIN_CENTER_OF_VOLUME'
                layout.operator("view3d.snap_cursor_to_selected",text="Cursor to Selected",icon="PIVOT_CURSOR")
                layout.operator('view3d.snap_selected_to_cursor',text="Selected to Cursor",icon="CON_FOLLOWTRACK")
                layout.separator()
                layout.operator('object.link_materials',text="Link Materials",icon="MATERIAL")
                layout.operator('object.fix_materials_order',text="Fix Material Order",icon="LINENUMBERS_ON")
            if(context.active_object.mode=='EDIT'):
                layout.operator("object.set_pivot_to_active_area", text="Pivot to Active Area", icon="CENTER_ONLY")
                layout.operator('object.set_custom_orientation',text="Use Custom Orientation",icon="ORIENTATION_VIEW")
                layout.separator()
                layout.operator('mesh.loop_multi_select',text="Edge Loop",icon="IPO_EASE_IN_OUT").ring=False
                layout.operator('mesh.loop_multi_select',text="Edge Ring",icon="FORCE_FORCE").ring=True
                layout.operator('mesh.edge_collapse',text="Vertex Collapse",icon="MOD_SIMPLIFY")
                layout.operator('mesh.select_non_manifold',text="Mon Manifold",icon="MOD_SMOOTH")
                layout.separator()
                layout.menu("VIEW3D_MT_edit_mesh_normals", text="Normals", icon='SNAP_NORMAL')
                layout.menu("VIEW3D_MT_edit_mesh_select_similar", text="Select Similar", icon='RESTRICT_SELECT_OFF')
                layout.menu("VIEW3D_MT_edit_mesh_showhide", text="Show/Hide", icon='HIDE_ON')
                layout.menu("VIEW3D_MT_edit_mesh_clean", text="Clean", icon='BRUSH_DATA')
                layout.menu("VIEW3D_MT_mirror", text="Mirror", icon='MOD_MIRROR')
                layout.separator()
                layout.operator("view3d.snap_cursor_to_selected",text="Cursor to Selected",icon="PIVOT_CURSOR")
                layout.operator('view3d.snap_selected_to_cursor',text="Selected to Cursor",icon="CON_FOLLOWTRACK")
                layout.separator()
                layout.prop(context.tool_settings, "use_transform_correct_face_attributes", text="Use Transform Face UV")
        if bpy.context.space_data.type == 'IMAGE_EDITOR':
            layout = self.layout
            layout.operator("uv.average_islands_scale",text="Average Islands Scale",icon="MOD_ARRAY")
            operation=layout.operator("uv.pack_islands",text="Pack Islands",icon="IMAGE_PLANE")

# OPERADORES
class QuickMenuRL_OT_toggle_wireframe(bpy.types.Operator):
    bl_idname = "object.toggle_wireframe"
    bl_label = "Alternar Wireframe"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        overlay = context.space_data.overlay
        overlay.show_wireframes = not overlay.show_wireframes
        return {'FINISHED'}
class QuickMenuRL_OT_toggle_measurement(bpy.types.Operator):
    bl_idname = "object.toggle_measurement"
    bl_label = "Alternar Wireframe"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        bpy.context.space_data.overlay.show_extra_edge_length = not bpy.context.space_data.overlay.show_extra_edge_length
        return {'FINISHED'}
class QuickMenuRL_OT_set_pivot_to_cursor(bpy.types.Operator):
    bl_idname = "object.set_pivot_to_cursor"
    bl_label = "Pivot to Cursor"

    def execute(self, context):
        cursor_pos = context.scene.cursor.location.copy()
        context.scene.tool_settings.transform_pivot_point = "CURSOR"
        context.scene.tool_settings.snap_target = "CENTER"
        context.scene.cursor.location = cursor_pos
        return {'FINISHED'}
class QuickMenuRL_OT_set_pivot_to_center(bpy.types.Operator):
    bl_idname = "object.set_pivot_to_center"
    bl_label = "Pivot to Center"

    def execute(self, context):
        bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="BOUNDING_BOX_CENTER"
        bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
        return {'FINISHED'}
class QuickMenuRL_OT_set_pivot_to_active(bpy.types.Operator):
    bl_idname = "object.set_pivot_to_active"
    bl_label = "Pivot to Active"

    def execute(self, context):
        bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="ACTIVE_ELEMENT"
        bpy.data.scenes["Scene"].tool_settings.snap_target="ACTIVE"
        return {'FINISHED'}
class QuickMenuRL_OT_set_pivot_to_active_area(bpy.types.Operator):
    bl_idname = "object.set_pivot_to_active_area"
    bl_label = "Pivot to Active Area"

    def execute(self, context):
        bpy.ops.view3d.snap_cursor_to_selected()
        bpy.context.scene.tool_settings.transform_pivot_point = 'CURSOR'
        bpy.context.scene.tool_settings.snap_target = 'ACTIVE'
        return {'FINISHED'}
class QuickMenuRL_OT_set_pivot_to_object_center(bpy.types.Operator):
    bl_idname = "object.set_pivot_to_object_center"
    bl_label = "Pivot to Object Center"

    def execute(self, context):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="BOUNDING_BOX_CENTER"
        bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
        bpy.ops.view3d.snap_cursor_to_selected()
        bpy.ops.object.mode_set(mode='OBJECT')
        bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="CURSOR"
        bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
        return {'FINISHED'}
class QuickMenuRL_OT_set_pivot_to_object_point(bpy.types.Operator):
    bl_idname = "object.set_pivot_to_object_point"
    bl_label = "Pivot to Object Point"

    def execute(self, context):
        bpy.ops.object.mode_set(mode='EDIT')
        obj = bpy.context.active_object
        bm = bmesh.from_edit_mesh(obj.data)
        v = [v.co for v in bm.verts if v.select]

        if(len(v)>0):
            loc = obj.matrix_world @ (sum(v, Vector()) / len(v))
            bpy.context.scene.cursor.location = loc
        bpy.ops.object.mode_set(mode='OBJECT')
        cursorPosition=bpy.context.scene.cursor.location
        bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="CURSOR"
        bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
        bpy.context.scene.cursor.location=cursorPosition
        return {'FINISHED'}
class QuickMenuRL_OT_fix_materials_order(bpy.types.Operator):
    bl_idname = "object.fix_materials_order"
    bl_label = "Fix Materials Order"

    def execute(self, context):
        for obj in bpy.context.selected_objects:
            bpy.ops.object.mode_set(mode='OBJECT')
            bpy.ops.object.select_all(action='DESELECT')
            bpy.context.view_layer.objects.active=obj
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.sort_elements(type='MATERIAL', elements={'FACE'})
        return {'FINISHED'}
class QuickMenuRL_OT_link_materials(bpy.types.Operator):
    bl_idname = "object.link_materials"
    bl_label = "Link Materials"

    def execute(self, context):
        bpy.ops.object.make_links_data(type='MATERIAL')
        return {'FINISHED'}
class QuickMenuRL_OT_set_custom_orientation(bpy.types.Operator):
    bl_idname = "object.set_custom_orientation"
    bl_label = "Set Custom Orientation"

    def execute(self, context):
        bpy.ops.transform.create_orientation(name='orientation', overwrite=True)
        bpy.context.scene.transform_orientation_slots[1].type = 'orientation'
        return {'FINISHED'}
class QuickMenuRL_OT_select_object_group(bpy.types.Operator):
    bl_idname = "object.select_object_group"
    bl_label = "Select Object Group"

    def execute(self, context):
        top = context.active_object
        bpy.ops.object.select_all(action='DESELECT')

        while top:
            if "_" not in top.name: break
            elif top.parent: top = top.parent
            else: break
        top.select_set(True)
        context.view_layer.objects.active = top  
        return {'FINISHED'}

# ABRIR MENU
class QuickMenuRL_OT_call_main_menu(bpy.types.Operator):
    bl_idname = "wm.quickmenurl_popup"
    bl_label = "Abrir QuickMenuRL"

    def execute(self, context):
        bpy.ops.wm.call_menu(name=QuickMenuRL_MT_main.bl_idname)
        return {'FINISHED'}

# REGISTRO
addon_keymaps = []
classes = [
    QuickMenuRL_MT_main,
    QuickMenuRL_OT_call_main_menu,
    QuickMenuRL_OT_toggle_wireframe,
    QuickMenuRL_OT_toggle_measurement,
    QuickMenuRL_OT_select_object_group,
    QuickMenuRL_OT_set_pivot_to_cursor,
    QuickMenuRL_OT_set_pivot_to_center,
    QuickMenuRL_OT_set_pivot_to_active,
    QuickMenuRL_OT_set_pivot_to_active_area,
    QuickMenuRL_OT_set_pivot_to_object_center,
    QuickMenuRL_OT_set_pivot_to_object_point,
    QuickMenuRL_OT_link_materials,
    QuickMenuRL_OT_set_custom_orientation,
    QuickMenuRL_OT_fix_materials_order,
]

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    wm = bpy.context.window_manager
    kc = wm.keyconfigs.addon

    if kc:
        # VIEW_3D
        km = kc.keymaps.new(name='3D View', space_type='VIEW_3D')
        kmi = km.keymap_items.new('wm.call_menu', type='Q', value='PRESS')
        kmi.properties.name = "QUICKMENURL_MT_main"
        addon_keymaps.append((km, kmi))

        # IMAGE_EDITOR (UV Editor)
        km = kc.keymaps.new(name='Image', space_type='IMAGE_EDITOR')
        kmi = km.keymap_items.new('wm.call_menu', type='Q', value='PRESS')
        kmi.properties.name = "QUICKMENURL_MT_main"
        addon_keymaps.append((km, kmi))

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    # Remove atalho
    for km, kmi in addon_keymaps:
        km.keymap_items.remove(kmi)
    addon_keymaps.clear()

if __name__ == "__main__":
    register()
