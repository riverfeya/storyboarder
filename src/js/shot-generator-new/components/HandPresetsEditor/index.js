import { remote } from 'electron'
import React from 'react'
const  { useState, useEffect, useMemo, forwardRef, useRef } = React
import { connect } from 'react-redux'
import prompt from 'electron-prompt'
import * as THREE from 'three'
window.THREE = THREE
import { machineIdSync } from 'node-machine-id'
import pkg from '../../../../../package.json'
import request from 'request'

import { FixedSizeGrid } from 'react-window'

import {
  updateObject,
  createHandPosePreset,

  getSceneObjects
} from '../../../shared/reducers/shot-generator'
import defaultPosePresets from '../../../shared/reducers/shot-generator-presets/hand-poses.json'
import presetsStorage from '../../../shared/store/presetsStorage'
import ListItem from './ListItem'
import { NUM_COLS, GUTTER_SIZE, ITEM_WIDTH, ITEM_HEIGHT, CHARACTER_MODEL } from './ItemSettings'
import { searchPresetsForTerms } from '../../utils/searchPresetsForTerms'
import { filepathFor } from '../../utils/filepathFor'

import '../../../vendor/three/examples/js/utils/SkeletonUtils'

import deepEqualSelector from './../../../utils/deepEqualSelector'

const shortId = id => id.toString().substr(0, 7).toLowerCase()

const getAttachmentM = deepEqualSelector([(state) => state.attachments], (attachments) => { 
    let filepath = filepathFor(CHARACTER_MODEL)
    return !attachments[filepath] ? undefined : attachments[filepath].status
})

const HandPresetsEditor = connect(
  state => ({
    attachmentStatus: getAttachmentM(state),
    handPosePresets: state.presets.handPoses,
  }),
  {
    updateObject,
    createHandPosePreset,
    withState: (fn) => (dispatch, getState) => fn(dispatch, getState())
  }
)(
React.memo(({
  id,
  handPosePresetId,
  handPosePresets,
  attachmentStatus,

  updateObject,
  createHandPosePreset,
  withState,
  scene
}) => {
  const thumbnailRenderer = useRef()

  const [ready, setReady] = useState(false)
  const [terms, setTerms] = useState(null)

  const getAttachment = () => {
    let attachment 
    withState((dispatch, state) => {
      let filepath = filepathFor(CHARACTER_MODEL)
      attachment = state.attachments[filepath].value
    })
    return attachment
  }
  const [attachment, setAttachment] = useState(getAttachment())
 console.log("Render")
  const presets = useMemo(() => searchPresetsForTerms(Object.values(handPosePresets), terms), [handPosePresets, terms])
  const [selectedHand, setSelectedHand] = useState("BothHands")

  useEffect(() => {
    if (ready) return
    if (attachmentStatus === "Success" && !attachment) {
        let attachment = getAttachment()
        setAttachment(attachment)
        setTimeout(() => {
          setReady(true)
        }, 100) // slight delay for snappier character selection via click
      }
    }, [attachmentStatus])

  const onChangeHand = event => {
    setSelectedHand(event.target.value)
  }

  const onChange = event => {
    event.preventDefault()
    setTerms(event.currentTarget.value)
  }

  const onCreateHandPosePreset = event => {
    event.preventDefault()

    // show a prompt to get the desired preset name
    let win = remote.getCurrentWindow()
    console.log(win)
    win.webPreferences.webSecurity = false
    prompt({
      title: "Preset Name",
      label: "Select a Preset Name",
      value: "HandPose ${shortId(THREE.Math.generateUUID())}",
    }, win)
     .then(name => { if( name ) 
      prompt({   
        title: "Hand chooser ",
        lable: "Select which hand to save ",   
        type: "select",
        selectOptions: { 
            "LeftHand": "Left Hand",
            "RightHand": "Right Hand",
        }}, win).then((handName) => { if(handName) {
            if (name != null && name != '' && name != ' ') {
              withState((dispatch, state) => {
                // get the latest skeleton data
                let sceneObject = getSceneObjects(state)[id]
                let skeleton = sceneObject.skeleton
                let model = sceneObject.model
                let originalSkeleton = scene.children.filter(child => child.userData.id === id)[0].getObjectByProperty("type", "SkinnedMesh").skeleton.bones
                let handSkeleton = {}
                setSelectedHand(handName)
                for(let i = 0; i < originalSkeleton.length; i++) {
                    let key = originalSkeleton[i].name
                    if(key.includes(handName) && key !== handName) {
                      let rot = originalSkeleton[i].rotation
                      handSkeleton[key] = { rotation: { x: rot.x, y: rot.y, z: rot.z } }
                    }
                }
                // create a preset out of it
                let newPreset = {
                  id: THREE.Math.generateUUID(),
                  name,
                  keywords: name, // TODO keyword editing
                  state: {
                    handSkeleton: handSkeleton || {}
                  },
                  priority: 0
                }
                // add it to state
                createHandPosePreset(newPreset)
            
                // save to server
                // for pose harvesting (maybe abstract this later?)
                request.post('https://storyboarders.com/api/create_pose', {
                  form: {
                    name: name,
                    json: JSON.stringify(skeleton),
                    model_type: model,
                    storyboarder_version: pkg.version,
                    machine_id: machineIdSync()
                  }
                })
            
                // select the preset in the list
                updateObject(id, { handPosePresetId: newPreset.id })
            
                // get updated state (with newly created pose preset)
                withState((dispatch, state) => {
                  // ... and save it to the presets file
                  let denylist = Object.keys(defaultPosePresets)
                  let filteredPoses = Object.values(state.presets.handPoses)
                    .filter(pose => denylist.includes(pose.id) === false)
                    .reduce(
                      (coll, pose) => {
                        coll[pose.id] = pose
                        return coll
                      },
                      {}
                    )
                  presetsStorage.saveHandPosePresets({ handPoses: filteredPoses })
                })
              })
            }}}
    ).catch(err =>
      console.error(err)
    )})
  }

  // via https://reactjs.org/docs/forwarding-refs.html
  const innerElementType = forwardRef(({ style, ...rest }, ref) => {
    let newStyle = {
      width: 288,
      position: "relative",
      overflow: "hidden",
      ...style
    }
    return <div
        ref={ ref }
        style={ newStyle }
        { ...rest }/>
  })

  return attachment && <div className="thumbnail-search column">
      <div className="row" style={{ padding: "6px 0" }}> 
         <div className="column" style={{ flex: 1 }}> 
          <input placeholder="Search for a hand pose …"
                 onChange={ onChange} />
        </div>
        <div className="column" style={{ marginLeft: 5 }}> 
          <a className="button_add" href="#"
            style={{ width: 30, height: 34 }}
            onPointerDown={ onCreateHandPosePreset }
           >+</a>
        </div>
      </div> 
      <div className="row" style= {{ padding: "6px 0" }} >
        <div style={{ width: 50, display: "flex", alignSelf: "center" }}>Select hand</div> 
        <div className="column" style={{ flex: 1 }}>
          <select onChange={ onChangeHand }
            value={ selectedHand }>
          <option value="LeftHand">Left Hand</option> 
          <option value="RightHand">Right Hand</option> 
          <option value="BothHands">Both Hands</option> 
          </select>
        </div>
      </div>
      <div className="thumbnail-search__list">
       <FixedSizeGrid 
          columnCount={ NUM_COLS }
          columnWidth={ ITEM_WIDTH + GUTTER_SIZE }

          rowCount={ Math.ceil(presets.length / NUM_COLS) }
          rowHeight={ ITEM_HEIGHT }
          width={ 288 }
          height={ 363 }
          innerElementType={ innerElementType }
          itemData={{
            presets,

            id: id,
            handPosePresetId,

            attachment,
            updateObject,

            thumbnailRenderer,
            withState,
            selectedHand
        }}
        children={ ListItem }/>
    </div>
  </div> 
}))

export default HandPresetsEditor

