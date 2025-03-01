import * as THREE from "three";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { assignSensorLabels, clearAllSensors, drawSensorsAndUpdateGlobalValues, loadSensorCoordinates, sensorMaterial } from "../js/draw_sensors.js";
import "regenerator-runtime/runtime.js";
import { addLightAndBackground } from "../js/add_light_and_background";
import { loadAndDrawCortexModel, loadAndDrawCortexDualModel, handleTransformControlChangeEvent, updateTransformControlHistory } from "../js/draw_cortex.js";
import { clearLoadAndDrawSensors,
  loadAndAssignSensorLabels } from '../js/draw_sensors.js';
import {
  loadAndDrawLinks,
  clearAllLinks,
  generateLinkData,
  drawLinksAndUpdateVisibility,
  ecoFiltering,
  loadAndDrawLinksFromUrl
} from "../js/link_builder/draw_links";
import { setupCamera } from '../js/setup_camera';
import { guiParams, setupGui } from '../js/setup_gui';
import { loadJsonData, jsonLoadingNodeCheckForError, jsonLoadingEdgeCheckForError } from "../js/load_data";
import { userLogError, userLogMessage } from "../js/logs_helper";
import { GUI } from 'dat.gui';
import { hexToHsl } from "../js/color_helper";

const highlightedLinksPreviousMaterials = [];

let cortexMeshUrl = require('../data/cortex_model.glb');
let innerSkullMeshUrl = require('../data/innskull.glb');
let scalpMeshUrl = require('../data/scalp.glb');
let sensorLabelsUrl = require('../data/sensor_labels.csv');
let sensorCoordinatesUrl = require('../data/sensor_coordinates.csv');
let connectivityMatrixUrl = require('../data/connectivity_matrix.csv');

const GLOBAL_LAYER = 0,  LINK_LAYER = 1;

let mouseButtonIsDown = false;

const enlightenedSensorMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  reflectivity: 1
});

const linkMeshList = [];
const sensorMeshList = [];

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({
  preserveDrawingBuffer: true,
  antialias: true
});
renderer.domElement.id = 'renderer';
let camera = new THREE.PerspectiveCamera();

const uiScene = new THREE.Scene();
let uiCamera = new THREE.OrthographicCamera();

const orbitControls = new OrbitControls(camera, renderer.domElement);
const transformControls = new TransformControls(camera, renderer.domElement);
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let gui = new GUI();

document.body.appendChild(renderer.domElement);
const sensorNameDiv = document.getElementById("sensorName");
const csvConnMatrixInput = document.getElementById("csvConnMatrixInput");
const csvNodePositionsInput = document.getElementById("csvNodePositions");
const csvNodeLabelsInput = document.getElementById("csvNodeLabels");
const jsonInput = document.getElementById("jsonInput");

//intersectedNodeList is used to check wether the mouse intersects with a sensor
var intersectedNode;

//mouseDownDate is used to check the time between mouseDown and mouseUpEvents in order to yield a clickEvent is the time is low enough
let mouseDownDate;

init();
animate();
connectToWebSocket();

function init() {
  THREE.Cache.enabled = true;
  renderer.autoClear = false;
  renderer.setPixelRatio( window.devicePixelRatio );
  setupGui();
  generateSceneElements();

  window.addEventListener("resize", onWindowResize);
  document.addEventListener("mousemove", onDocumentMouseMove);
  transformControls.addEventListener('dragging-changed', (event)=>{
    orbitControls.enableDamping = false;
    orbitControls.enabled = !event.value;
    orbitControls.enableDamping = true;
  });
  transformControls.addEventListener("objectChange", handleTransformControlChangeEvent);
  renderer.domElement.addEventListener("mousedown", onRendererMouseDown);
  renderer.domElement.addEventListener("mouseup", onRendererMouseUp);
  csvConnMatrixInput.addEventListener("change", handleConnectivityMatrixFileSelect, false);
  csvNodePositionsInput.addEventListener("change", handleMontageCoordinatesFileSelect, false);
  csvNodeLabelsInput.addEventListener("change", handleMontageLabelsFileSelect, false);
  jsonInput.addEventListener("change", handleJsonFileSelect, false);
}

function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  hoverDisplayUpdate();
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(uiScene, uiCamera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function generateSceneElements() {
  setupCamera();
  addLightAndBackground();
  scene.add( transformControls );
  loadAndDrawCortexModel();
  // loadAndDrawCortexDualModel();
  const data = await loadSensorCoordinates(sensorCoordinatesUrl);
  await drawSensorsAndUpdateGlobalValues(data);
  await loadAndAssignSensorLabels(sensorLabelsUrl);
  await loadAndDrawLinksFromUrl(connectivityMatrixUrl);
}

function onDocumentMouseMove(event) {
  event.preventDefault();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  const padding = 15;
  sensorNameDiv.style.top = event.clientY + padding + "px";
  sensorNameDiv.style.left = event.clientX + padding + "px";
}

function onRendererMouseDown(event){
  mouseButtonIsDown=true;
  mouseDownDate = Date.now();
}

function onRendererMouseUp(event){
  mouseButtonIsDown = false;
  if (Date.now() - mouseDownDate < 500){
    onDocumentMouseClick(event);
  }
  updateTransformControlHistory();
}

function onDocumentMouseClick(event){

}

function hoverDisplayUpdate() {
  const intersects = getRaycastedNodes();
  emptyIntersected();
  if (intersects.length) {
    intersectedNode = intersects[0].object;
    fillIntersected();
  }
}

function getRaycastedNodes(){
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObjects(sensorMeshList.map(x=>x.mesh));
}

function emptyIntersected() {
  if (intersectedNode) {
    intersectedNode.material = sensorMaterial;
    if (guiParams.sensorOpacity == 0){
      intersectedNode.visible = true;
    }
  }
  intersectedNode = null;
  sensorNameDiv.innerHTML = "";
  sensorNameDiv.style.visibility = 'hidden';
  while (highlightedLinksPreviousMaterials.length > 0) {
    const elem = highlightedLinksPreviousMaterials.shift();
    for (const linkMesh of linkMeshList
      .filter((linkMesh) => linkMesh.link.node1 === elem.node1 && linkMesh.link.node2 === elem.node2)){
      linkMesh.mesh.material = elem.material;
    }
  }
}

function fillIntersected() {
  intersectedNode.material = enlightenedSensorMaterial;
  intersectedNode.visible = true;
  sensorNameDiv.innerHTML = intersectedNode.name;
  if (sensorNameDiv.innerHTML){sensorNameDiv.style.visibility = 'visible';}
  for (const linkMesh of linkMeshList){
    if (linkMesh.link.node1 === intersectedNode || linkMesh.link.node2 === intersectedNode)
    {
      highlightedLinksPreviousMaterials.push({
        node1: linkMesh.link.node1,
        node2: linkMesh.link.node2,
        material: linkMesh.mesh.material});
      let color = hexToHsl(guiParams.backgroundColor).l < 50 ? new THREE.Color(1,1,1) : new THREE.Color(0,0,0);
      linkMesh.mesh.material = new THREE.LineBasicMaterial({
        color : color,
        opacity: 1,
        transparent: false
      });
    }
  }
}

function getNewFileUrl(evt){
  if (evt.target.files.length === 0) { return; }
  const file = evt.target.files[0];
  return window.URL.createObjectURL(file);
}

function handleConnectivityMatrixFileSelect(evt) {
  const fileUrl = getNewFileUrl(evt);
  const fileName = evt.target.files[0].name;
  loadAndDrawLinksFromUrl(fileUrl).then(
      ()=>{ userLogMessage("Connectivity matrix file " + fileName + "succesfully loaded.", "green")},
        (e) => userLogError(e, fileName)
    );
}

function handleMontageCoordinatesFileSelect(evt) {
  sensorCoordinatesUrl = getNewFileUrl(evt);
  const fileName = evt.target.files[0].name;
  clearLoadAndDrawSensors(sensorCoordinatesUrl)
    .then(() => userLogMessage("Coordinates file " + fileName + " succesfully loaded.", "green"),
      (e)=>userLogError(e, fileName)
    );
}

function handleMontageLabelsFileSelect(evt) {
  sensorLabelsUrl = getNewFileUrl(evt);
  const fileName = evt.target.files[0].name;
  loadAndAssignSensorLabels(sensorLabelsUrl)
    .then(() => userLogMessage("Labels file " + fileName + " succesfully loaded.", "green"),
      (e)=>userLogError(e, fileName)
    );
}

async function handleJsonFileSelect(evt){
  const jsonUrl = getNewFileUrl(evt);
  const fileName = evt.target.files[0].name;
  try{
    const jsonData = await loadJsonData(jsonUrl);
    if (!jsonData.graph){
      throw new TypeError("Graph attribute is missing.");
    }
    if (!jsonData.graph.nodes){
      throw new TypeError("No nodes folder.");
    }
    if (!jsonData.graph.edges){
      throw new TypeError("No edges folder.");
    }

    const graph = jsonData.graph;
    const coordinatesList  = [];
    const labelList = [];
    const linkList = [];
    const sensorIdMap = new Map();
    let i = 0;
    for (const [key, value] of Object.entries(graph.nodes)){
      jsonLoadingNodeCheckForError(key, value, i, sensorIdMap);
      i++;
      coordinatesList.push([parseFloat(value.position.x), parseFloat(value.position.y), parseFloat(value.position.z)]);
      let label = '';
      if (value.label) { label = value.label; }
      labelList.push(label);
      sensorIdMap.set(value.id.toString(), labelList.length - 1);
    }

    i=0;
    for (const [key, value] of Object.entries(graph.edges)){
      jsonLoadingEdgeCheckForError(key, value, i, coordinatesList.length, sensorIdMap);
      i++;
    }

    // ------- update the mesh once basic errors are checked
    await clearAllLinks();
    await clearAllSensors();
    await drawSensorsAndUpdateGlobalValues(coordinatesList);
    assignSensorLabels(labelList);

    for (const [key, value] of Object.entries(graph.edges)){
      if (value.strength != 0 && value.strength)
      linkList.push(generateLinkData(
        sensorIdMap.get(value.source.toString()),
        sensorIdMap.get(value.target.toString()),
        value.strength));
    }

    await drawLinksAndUpdateVisibility(linkList);
    ecoFiltering();

    userLogMessage('Json file ' + fileName + ' succesfully loaded.', 'green');
  }
  catch(e){
    userLogError(e, fileName);

  }
}

function connectToWebSocket() {
  const socket = new WebSocket('ws://localhost:8080');

  socket.addEventListener('open', function (event) {
    console.log('Connected to WebSocket server');
  });

  socket.addEventListener('message', async function (event) {
    const matrix = event.data?.trim()?.split('\n')
    await loadAndDrawLinks(matrix, true);
  });

  socket.addEventListener('close', function (event) {
    console.log('WebSocket connection closed. Reconnecting...');
    setTimeout(connectToWebSocket, 1000);
  });

  socket.addEventListener('error', function (error) {
    console.log('WebSocket error:', error);
    socket.close();
  });
}

export {
    scene,
    camera,
    transformControls,
    orbitControls as controls,
    renderer,
    linkMeshList,
    sensorMeshList,
    gui,
    cortexMeshUrl,
    innerSkullMeshUrl,
    scalpMeshUrl,
    sensorMaterial,
    GLOBAL_LAYER,
    LINK_LAYER,
    csvConnMatrixInput,
    csvNodePositionsInput,
    csvNodeLabelsInput,
    jsonInput,
    emptyIntersected,
    intersectedNode as intersectedNodeList,
    onWindowResize,
    uiScene,
    uiCamera,
    mouseButtonIsDown
};