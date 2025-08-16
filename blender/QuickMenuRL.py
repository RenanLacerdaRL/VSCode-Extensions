bl_info = {
    "name": "QuickMenu",
    "blender": (2, 80, 0),
    "category": "Object",
}
#******************************************************************************
import bpy
import bmesh
import mathutils

from bpy.app.handlers import persistent 
from mathutils import Vector, Matrix
#******************************************************************************
def mag(array):
    return (array[0] ** 2 + array[1] ** 2) ** 0.5

def AlignY(vertices,index): 
    for vert in vertices:
        vert.select=False
        if(vert.index==index[0] or vert.index==index[1]):
            vert.select=True
    bpy.ops.uv.align(axis='ALIGN_Y')
    
def AlignX(vertices,index):
    for vert in vertices:
        vert.select=False
        if(vert.index==index[0] or vert.index==index[1]):
            vert.select=True
    bpy.ops.uv.align(axis='ALIGN_X')
#*****************************************************************************************
pivotMode=0
event2=None

class SimpleOperator(bpy.types.Operator):
    bl_idname="object.simple_operator"
    bl_label="Simple Object Operator"

    mode: bpy.props.StringProperty()
    is_localview: bpy.props.BoolProperty()
    origSel: None

    @classmethod
    def poll(cls, context):
        return context.active_object is not None

    def execute(self, context):
        global pivotMode

        #3D_VIEWPORT
        if(self.mode=="Pivot_Cursor"):
            #bpy.ops.view3d.snap_cursor_to_active()
            cursorPosition=bpy.context.scene.cursor.location
            bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="CURSOR"
            bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
            bpy.context.scene.cursor.location=cursorPosition
            pivotMode=0
        elif(self.mode=="Pivot_Center"):
            bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="BOUNDING_BOX_CENTER"
            bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
            pivotMode=0
        elif(self.mode=="Pivot_Active"):
            bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="ACTIVE_ELEMENT"
            bpy.data.scenes["Scene"].tool_settings.snap_target="ACTIVE"
            pivotMode=0
        elif(self.mode=="Pivot_Cursor_Mesh"):
            bpy.ops.object.mode_set(mode='EDIT')
            
            obj = bpy.context.active_object
            bm = bmesh.from_edit_mesh(obj.data)
            v = [v.co for v in bm.verts if v.select]

            if(len(v)>0):
                loc = obj.matrix_world @ (sum(v, Vector()) / len(v))
                bpy.context.scene.cursor.location = loc
                #space.snap_cursor_to_active()
        
            bpy.ops.object.mode_set(mode='OBJECT')
            cursorPosition=bpy.context.scene.cursor.location
            bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="CURSOR"
            bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
            bpy.context.scene.cursor.location=cursorPosition
            pivotMode=1
        elif(self.mode=="Pivot_Cursor_Center"):
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="BOUNDING_BOX_CENTER"
            bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
            bpy.ops.view3d.snap_cursor_to_selected()
            bpy.ops.object.mode_set(mode='OBJECT')
            #cursorPosition=bpy.context.scene.cursor.location
            bpy.data.scenes["Scene"].tool_settings.transform_pivot_point="CURSOR"
            bpy.data.scenes["Scene"].tool_settings.snap_target="CENTER"
            #bpy.context.scene.cursor.location=cursorPosition
            pivotMode=2

        elif(self.mode=="LocalView"):
            obj=bpy.context.active_object
            objs=bpy.context.selected_objects
            obj_mode=bpy.context.object.mode
            
            bpy.ops.object.mode_set(mode='OBJECT')
            if(self.is_localview==False):
                if(len(objs)>0):
                    self.is_localview=True
                    bpy.ops.object.select_all(action='INVERT')
                    bpy.ops.object.hide_view_set(unselected=False)
                    bpy.context.selected_objects.append(objs)
                    for o in objs: o.select_set(True)
                    obj.select_set(True)
                    bpy.ops.object.mode_set(mode=obj_mode)
                    bpy.context.space_data.overlay.show_annotation=False
            else:
                self.is_localview=False
                bpy.ops.object.hide_view_clear()
                bpy.ops.object.select_all(action='DESELECT')
                if(len(objs)>0): 
                    for o in objs: o.select_set(True)
                    obj.select_set(True)
                bpy.ops.object.mode_set(mode=obj_mode)
                bpy.context.space_data.overlay.show_annotation=True
        elif(self.mode=="ShowHideWireFrame"):
             if(bpy.context.space_data.overlay.show_wireframes==True):
                bpy.context.space_data.overlay.show_wireframes=False
             else:
                bpy.context.space_data.overlay.show_wireframes=True
        elif(self.mode=="ShowHideMeasurement"):
            #bpy.data.screens["Modeling"].overlay.show_extra_edge_length=True
            if(bpy.context.space_data.overlay.show_extra_edge_length==True):
                bpy.context.space_data.overlay.show_extra_edge_length=False
            else:
                bpy.context.space_data.overlay.show_extra_edge_length=True
        elif(self.mode=="SelectGroup"):
            objSelected=bpy.context.active_object
            objParents=bpy.context.selected_objects
            objSelection=[]
            
            while(len(objParents)>0):
                objIndex=objParents[0]

                bpy.context.view_layer.objects.active=objIndex
                bpy.ops.object.select_grouped(type='CHILDREN_RECURSIVE')
                objIndex.select_set(True)
                for o in bpy.context.selected_objects: objSelection.append(o)
                objParents.remove(objIndex)
 
            for o in objSelection: o.select_set(True)
            objSelected.select_set(True)

        elif(self.mode=="SelectChildren"):
            objParents=bpy.context.selected_objects
            objSelection=[]

            while(len(objParents)>0):
                objIndex=objParents[0]

                bpy.context.view_layer.objects.active=objIndex
                bpy.ops.object.select_grouped(type='CHILDREN_RECURSIVE')
                for o in bpy.context.selected_objects: objSelection.append(o)
                objParents.remove(objIndex)
 
            for o in objSelection: o.select_set(True)
        elif(self.mode=="CustomOrientation"):
            bpy.ops.transform.create_orientation(name='orientation',overwrite=True)
            bpy.context.scene.transform_orientation_slots[1].type = 'orientation'

        #UV_EDITOR
        if(self.mode=="UV_Pivot_Center"):
            for area in bpy.context.screen.areas:
                if area.type == 'IMAGE_EDITOR':
                    area.spaces[0].pivot_point="CENTER"
        elif(self.mode=="UV_Pivot_Cursor"):
            for area in bpy.context.screen.areas:
                if area.type == 'IMAGE_EDITOR':
                    area.spaces[0].pivot_point="CURSOR"
        elif(self.mode=="SizeFromCube"):
            obj=bpy.context.active_object
            cube_size=2
            cube_uv_size=0.25
            
            bpy.ops.object.mode_set(mode='OBJECT')
            bpy.ops.mesh.primitive_cube_add(size=cube_size)
            obj_cube=bpy.context.active_object
            obj.select_set(True)
            bpy.ops.object.mode_set(mode='EDIT')
            
            bpy.ops.uv.average_islands_scale()
            
            bm=bmesh.from_edit_mesh(obj_cube.data)
            uv_layer=bm.loops.layers.uv.verify()
            bm.faces.ensure_lookup_table()
            pos_01=bm.faces[0].loops[0][uv_layer].uv
            pos_02=bm.faces[0].loops[1][uv_layer].uv
            distance=mag(pos_01-pos_02)

            percentage=((cube_uv_size*100)/distance)/100
            for o in bpy.context.selected_objects:
                bm=bmesh.from_edit_mesh(o.data)
                uv_layer=bm.loops.layers.uv.verify()
                for f in bm.faces:
                    for l in f.loops:
                        l[uv_layer].uv*=percentage
                      
            bpy.ops.object.mode_set(mode='OBJECT')
            bpy.data.objects.remove(obj_cube,do_unlink=True)
            bpy.context.view_layer.objects.active=obj
            bpy.ops.object.mode_set(mode='EDIT')
            
        elif(self.mode=="PackIslandSameSize"):
            obj=bpy.context.active_object
            bm=bmesh.from_edit_mesh(obj.data)
            uv_layer=bm.loops.layers.uv.verify()
            
            face_index=0
            for f in bm.faces:
                if(f.select==True):
                    face_index=f.index
                    break
                    
            pos_01=bm.faces[face_index].loops[0][uv_layer].uv
            pos_02=bm.faces[face_index].loops[1][uv_layer].uv
            distance_01=mag(pos_01-pos_02)

            bpy.ops.uv.pack_islands(rotate=False,margin=0.01)

            pos_01=bm.faces[face_index].loops[0][uv_layer].uv
            pos_02=bm.faces[face_index].loops[1][uv_layer].uv
            distance_02=mag(pos_01-pos_02)

            percentage=((distance_01*100)/distance_02)/100

            for f in bm.faces:
                if(f.select==True):
                    for l in f.loops:
                        l[uv_layer].uv*=percentage
        elif(self.mode=="FollowSelectedQuads"):
            bpy.ops.uv.select_linked()
            bpy.ops.uv.follow_active_quads()
        elif(self.mode=="AutoSelectedQuads"):
            top_01=[-1,0]
            top_02=[-1,0]
            down_01=[-1,1]
            down_02=[-1,1]
            left_01=[-1,1]
            left_02=[-1,1]
            right_01=[-1,0]
            right_02=[-1,0]
            face_index=0
            
            obj=bpy.context.active_object
            bm=bmesh.from_edit_mesh(obj.data)
            uv_layer=bm.loops.layers.uv.verify()
            for face in bm.faces:
                if(face.select):
                    face_index=face.index
                    for loop in face.loops:
                        if(loop[uv_layer].uv[1]>top_02[1]):
                            top_02=[loop.vert.index,loop[uv_layer].uv[1]]
                            if(top_02[1]>top_01[1]):
                                temp_top=top_01
                                top_01=top_02
                                top_02=temp_top
                        if(loop[uv_layer].uv[1]<down_02[1]):
                            down_02=[loop.vert.index,loop[uv_layer].uv[1]]
                            if(down_02[1]<down_01[1]):
                                temp_down=down_01
                                down_01=down_02
                                down_02=temp_down
                        if(loop[uv_layer].uv[0]<left_02[1]):
                            left_02=[loop.vert.index,loop[uv_layer].uv[0]]
                            if(left_02[1]<left_01[1]):
                                temp_left=left_01
                                left_01=left_02
                                left_02=temp_left
                        if(loop[uv_layer].uv[0]>right_02[1]):
                            right_02=[loop.vert.index,loop[uv_layer].uv[0]]
                            if(right_02[1]>right_01[1]):
                                temp_right=right_01
                                right_01=right_02
                                right_02=temp_right
                                
            bpy.ops.mesh.select_mode(type="VERT")
            vertices=[v for v in bm.verts]
            AlignY(vertices,[top_01[0],top_02[0]])
            AlignY(vertices,[down_01[0],down_02[0]])
            AlignX(vertices,[left_01[0],left_02[0]])
            AlignX(vertices,[right_01[0],right_02[0]])

            bpy.ops.mesh.select_mode(type="FACE")
            for face in bm.faces:
                if(face.index==face):
                    face.select=True
                    break
            bpy.ops.uv.select_linked()
            bpy.ops.uv.follow_active_quads()
        if(self.mode=="CursorToSelected"):
            bpy.ops.uv.snap_cursor(target='SELECTED')
            
        elif(self.mode=="ExportTexture"):
            for area in bpy.context.screen.areas:
                if(area.type=='IMAGE_EDITOR'):
                    image=area.spaces.active.image
                    image.pixels=area.spaces.active.image.pixels[:]
                    image.filepath_raw = bpy.path.abspath("//render.png")
                    image.file_format = 'PNG'
                    image.save()
        
        #MATERIAL_PROPERTIES
        elif(self.mode=="LinkMaterials"):    
            bpy.ops.object.make_links_data(type='MATERIAL')

        elif(self.mode=="SetAutoMaterials"):            
            for o in bpy.context.selected_objects:
                for i in range(0,len(o.data.materials)):
                    o.data.materials[i]=bpy.data.materials["Material_"+str(i+1).zfill(2)]
        elif(self.mode=="SetOcclusionMaterials"):
            for o in bpy.context.selected_objects:
                for i in range(0,len(o.data.materials)):
                    o.data.materials[i]=bpy.data.materials["Material_Occlusion"]
        elif(self.mode=="SetUV0"):
            for o in bpy.context.selected_objects:    
                o.data.uv_layers.active=o.data.uv_layers[0]
        elif(self.mode=="SetUV1"):
            for o in bpy.context.selected_objects:
                o.data.uv_layers.active=o.data.uv_layers[1]
        elif(self.mode=="BakeAO"):   
            frequency=2500 #Hertz
            duration=500

            bpy.ops.object.bake(type="AO")
            #winsound.Beep(frequency,duration)
        elif(self.mode=="FixMaterialOrder"):
            for obj in bpy.context.selected_objects:
                bpy.ops.object.mode_set(mode='OBJECT')
                bpy.ops.object.select_all(action='DESELECT')
                
                bpy.context.view_layer.objects.active=obj

                bpy.ops.object.mode_set(mode='EDIT')
                bpy.ops.mesh.select_all(action='SELECT')
                bpy.ops.mesh.sort_elements(type='MATERIAL', elements={'FACE'})

        self.mode=""
        UpdateRegisters();
        return {'FINISHED'}

    def invoke(self, context, event):
        global event2
        if(event2==None): event2=event
        return self.execute(context)
#******************************************************************************
def register():
    bpy.utils.register_class(SimpleOperator)
    #bpy.app.timers.register(UpdateSelection)
    
    # Initial congifuration
    # Q = wm.call_menu > OBJECT_MT_quickmenu
    # / = object.simple_operator > LocalView

def unregister():
    bpy.utils.unregister_class(SimpleOperator)
    bpy.app.timers.register(UpdateSelection)

if __name__ == "__main__":
    register()
    
def UpdateRegisters():
    if not bpy.app.timers.is_registered(UpdateSelection): bpy.app.timers.register(UpdateSelection)

#******************************************************************************
class QuickMenu(bpy.types.Menu):
    bl_idname="OBJECT_MT_quickmenu"
    bl_label="Quick Menu"

    level=bpy.props.BoolProperty()
        
    def draw(self, context):
        layout=self.layout
        
        #VIEW_3D/EDIT
        if(bpy.context.space_data.type=='VIEW_3D'):
            layout.operator('object.simple_operator',icon="SHADING_WIRE",text="Show/Hide Wireframe").mode="ShowHideWireFrame"
            layout.operator('object.simple_operator',icon="DRIVER_DISTANCE",text="Show/Hide Measurement").mode="ShowHideMeasurement"
            layout.separator()
            layout.operator('object.simple_operator',text="Pivot Cursor",icon="CURSOR").mode="Pivot_Cursor"
            layout.operator('object.simple_operator',text="Pivot Center",icon="PIVOT_MEDIAN").mode="Pivot_Center"
            layout.operator('object.simple_operator',text="Pivot Active",icon="PIVOT_ACTIVE").mode="Pivot_Active"
            layout.operator('object.simple_operator',text="Pivot Cursor Mesh",icon="PIVOT_CURSOR").mode="Pivot_Cursor_Mesh"
            layout.operator('object.simple_operator',text="Pivot Cursor Center",icon="PIVOT_MEDIAN").mode="Pivot_Cursor_Center"
            layout.separator()
            if(context.active_object.mode=='EDIT'):
                layout.operator('object.simple_operator',text="Use Custom Orientation",icon="ORIENTATION_VIEW").mode="CustomOrientation"
                layout.separator()
                layout.operator('mesh.loop_multi_select',text="Edge Loop",icon="IPO_EASE_IN_OUT").ring=False
                layout.operator('mesh.loop_multi_select',text="Edge Ring",icon="FORCE_FORCE").ring=True
                layout.operator('mesh.edge_collapse',text="Vertex Collapse",icon="MOD_SIMPLIFY")
                layout.operator('mesh.select_non_manifold',text="Mon Manifold",icon="MOD_SMOOTH")
                layout.separator()
                layout.menu("VIEW3D_MT_edit_mesh_normals")
                layout.menu("VIEW3D_MT_edit_mesh_select_similar")
                layout.menu("VIEW3D_MT_edit_mesh_showhide")
                layout.menu("VIEW3D_MT_edit_mesh_clean")
                layout.menu("VIEW3D_MT_mirror")
                layout.operator("mesh.duplicate_move",text="Duplicate",icon="DUPLICATE")
            if(context.active_object.mode=='OBJECT'):
                layout.menu("VIEW3D_MT_object_apply")
                layout.menu("VIEW3D_MT_object_parent")
                layout.operator('object.simple_operator',text="Select Group").mode="SelectGroup"
                layout.operator('object.simple_operator',text="Select Children").mode="SelectChildren"
                #layout.menu("VIEW3D_MT_object_collection")
                layout.menu("VIEW3D_MT_make_links")
                layout.menu("VIEW3D_MT_make_single_user")
                layout.menu("VIEW3D_MT_mirror")
                layout.menu("VIEW3D_MT_object_showhide")
                layout.operator("object.join",text="Join",icon="META_DATA")
                operation=layout.operator("object.duplicate",text="Duplicate",icon="DUPLICATE")
                operation.linked=True
                operation=layout.operator('object.convert',icon="OUTLINER_DATA_CURVE", text="Curve From Mesh/Text")
                operation.target='CURVE'
                operation=layout.operator('object.convert',icon="MESH_DATA", text="Mesh From Curve/Meta/Surf/Text")
                operation.target='MESH'
            layout.separator()
            if(context.active_object.mode=='OBJECT'):
                layout.separator()
                layout.prop(context.tool_settings, "use_transform_data_origin", text="Set Origins")
            layout.operator("view3d.snap_cursor_to_selected",text="Cursor to Selected",icon="PIVOT_CURSOR")
            if(context.active_object.mode=='EDIT'):
                layout.operator("view3d.snap_cursor_to_active",text="Cursor to Active",icon="PIVOT_CURSOR")
            if(context.active_object.mode=='OBJECT'):  
                operation=layout.operator("object.origin_set",text="Origin to Center",icon="PIVOT_BOUNDBOX")
                operation.type="ORIGIN_GEOMETRY"
                operation.center="BOUNDS"
            layout.operator('view3d.snap_selected_to_cursor',text="Selected to Cursor",icon="CON_FOLLOWTRACK")
            layout.separator()
            layout.operator('object.simple_operator',icon="HOLDOUT_ON",text="Local View").mode="LocalView"
            layout.operator('view3d.navigate',icon="CAMERA_STEREO", text="Walk Navegations")
            layout.operator('view3d.zoom_border',icon="BORDERMOVE", text="Zoom Region")
            #layout.prop(context.space_data, "lock_cursor", text="Look To Cursor")
            if(context.active_object.mode=='EDIT'):
                layout.separator()
                layout.prop(context.tool_settings, "use_transform_correct_face_attributes", text="Use Transform Face UV")
        
        #IMAGE_EDITOR
        elif(bpy.context.space_data.type=='IMAGE_EDITOR'):
            layout.operator('object.simple_operator',text="Pivot Center",icon="PIVOT_MEDIAN").mode="UV_Pivot_Center"
            layout.operator('object.simple_operator',text="Pivot Cursor",icon="PIVOT_CURSOR").mode="UV_Pivot_Cursor"
            layout.separator()
            layout.operator("uv.average_islands_scale",text="Average Islands Scale",icon="MOD_ARRAY")
            operation=layout.operator("uv.pack_islands",text="Pack Islands",icon="IMAGE_PLANE")
            operation.rotate=False
            operation.margin=0.01
            layout.operator('object.simple_operator',text="Size From Cube (2m)",icon="MOD_UVPROJECT").mode="SizeFromCube"
            layout.operator('object.simple_operator',text="Pack Islands Same Size",icon="IMAGE_REFERENCE").mode="PackIslandSameSize"
            layout.separator()
            layout.operator('uv.align',text="Align Auto Vertex",icon="SURFACE_NCURVE")
            layout.operator('object.simple_operator',text="Follow Selected Quads",icon="MOD_LATTICE").mode="FollowSelectedQuads"
            layout.operator('object.simple_operator',text="Auto Follow Selected Quads",icon="OUTLINER_OB_LATTICE").mode="AutoSelectedQuads"
            layout.separator()
            layout.operator('object.simple_operator',text="Cursor To Selected",icon="PIVOT_CURSOR").mode="CursorToSelected"
            layout.separator()
            layout.operator('object.simple_operator',text="Export Texture",icon="RESTRICT_RENDER_OFF").mode="ExportTexture"
        
        #PROPERTIES
        elif(bpy.context.space_data.type=='PROPERTIES'):
            layout.operator('object.simple_operator',text="Link Materials",icon="MATERIAL").mode="LinkMaterials"
            layout.operator('object.simple_operator',icon="LINENUMBERS_ON",text="Fix Material Order").mode="FixMaterialOrder"
            layout.separator()
            layout.operator('object.simple_operator',text="Set Auto Materials",icon="BRUSH_MIX").mode="SetAutoMaterials"
            layout.operator('object.simple_operator',text="Set Occlusion Materials",icon="BRUSH_SCULPT_DRAW").mode="SetOcclusionMaterials"
            layout.separator()
            layout.operator('object.simple_operator',text="Set UV0",icon="MATCLOTH").mode="SetUV0"
            layout.operator('object.simple_operator',text="Set UV1",icon="MATCLOTH").mode="SetUV1"
            layout.separator()
            layout.operator('object.simple_operator',text="Bake Occlusion Map",icon="TEMP").mode="BakeAO"
#******************************************************************************
previousSelectedObjects=None
previousSelectedObjectsLocation=[0,0,0]

def UpdateSelection():
    global previousSelectedObjects
    global previousSelectedObjectsLocation
    global pivotMode
    global event2

    selectedObjects=bpy.context.selected_objects

    if(event2==None): bpy.ops.object.simple_operator('INVOKE_DEFAULT')
    
    if(selectedObjects!=previousSelectedObjects):
        existsObjectActive=False

        for obj in selectedObjects: 
            if(obj==bpy.context.active_object): existsObjectActive=True
            
        if(existsObjectActive==False):
            if(len(selectedObjects)>0): bpy.context.view_layer.objects.active=selectedObjects[0]
        previousSelectedObjects=selectedObjects 

        pivotMode=0

    if(len(selectedObjects)>0):
        if(event2.type == 'LEFTMOUSE'):
            if(event2.value == 'RELEASE'):
                selectedOBJPosition=selectedObjects[0].location
                if(CompareVector(previousSelectedObjectsLocation,selectedOBJPosition)==False):
                    previousSelectedObjectsLocation=[selectedOBJPosition[0],selectedOBJPosition[1],selectedOBJPosition[2]]
                    if(pivotMode==1): 
                        bpy.ops.object.simple_operator(mode="Pivot_Cursor_Mesh")
                    elif(pivotMode==22):
                        bpy.ops.object.simple_operator(mode="Pivot_Cursor_Center")
                    print(str(pivotMode)+"   "+str(selectedObjects[0].location))
    return 0.250

def CompareVector(vectorA,vectorB):
    if(vectorA[0]!=vectorB[0]): return False
    if(vectorA[1]!=vectorB[1]): return False
    if(vectorA[2]!=vectorB[2]): return False
    return True
#******************************************************************************
bpy.utils.register_class(QuickMenu)
bpy.app.timers.register(UpdateSelection)

# handle the keymap
#wm = bpy.context.window_manager
#km = wm.keyconfigs.addon.keymaps.new(name='Object Mode', space_type='EMPTY')
#kmi = km.keymap_items.new(WorkMacro.bl_idname, 'ZERO', 'PRESS', ctrl=False, shift=False)
#addon_keymaps.append(km)
#bpy.ops.wm.call_menu(name="OBJECT_MT_quickmenu") # test call to display immediately.
