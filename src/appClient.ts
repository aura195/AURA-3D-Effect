import * as THREE from 'three';
import { OrbitControls, EffectComposer, RenderPass, OutputPass, UnrealBloomPass, ShaderPass, TeapotGeometry, GLTFLoader } from 'three/examples/jsm/Addons.js';
import snoise from './lib/noise/snoise.glsl';

export async function start(canvas: HTMLCanvasElement) {
  document.body.classList.add('loading');

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.001, 100);
  cam.position.set(0, 3, 0);
  cam.rotation.set(Math.PI/2, 0, 0);
  const blackColor = new THREE.Color(0x000000);
  scene.background = blackColor;

  const re = new THREE.WebGLRenderer({ canvas, antialias: true });
  re.setPixelRatio(window.devicePixelRatio);
  re.setSize(canvas.clientWidth, canvas.clientHeight, false);
  re.toneMapping = THREE.CineonToneMapping;
  re.outputColorSpace = THREE.SRGBColorSpace;

  const effectComposer1 = new EffectComposer(re);
  const renderPass = new RenderPass(scene, cam);
  const radius = 0.25;
  const unrealBloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerHeight, window.innerWidth), 0.5, radius, 0.2);
  const outPass = new OutputPass();

  const effectComposer2 = new EffectComposer(re);
  const shaderPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uBloomTexture: { value: effectComposer1.renderTarget2.texture },
      uStrength: { value: 8.0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D uBloomTexture; uniform float uStrength; varying vec2 vUv; void main(){ vec4 baseEffect=texture2D(tDiffuse,vUv); vec4 bloomEffect=texture2D(uBloomTexture,vUv); gl_FragColor=baseEffect + bloomEffect * uStrength; }`,
  }));

  effectComposer1.addPass(renderPass);
  effectComposer1.addPass(unrealBloomPass);
  effectComposer1.renderToScreen = false;
  effectComposer2.addPass(renderPass);
  effectComposer2.addPass(shaderPass);
  effectComposer2.addPass(outPass);

  const orbCtrls = new OrbitControls(cam, canvas);

  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256);
  const cubeCamera = new THREE.CubeCamera(0.1, 500, cubeRenderTarget);
  let cubeTexture: THREE.CubeTexture;

  const cubeTextureUrls = [
    '/cubeMap2/posx.png','/cubeMap2/negx.png','/cubeMap2/posy.png','/cubeMap2/negy.png','/cubeMap2/posz.png','/cubeMap2/negz.png',
  ];

  let skybox: THREE.Mesh;
  
  async function loadTextures() {
    const cubeTextureLoader = new THREE.CubeTextureLoader();
    cubeTexture = await cubeTextureLoader.loadAsync(cubeTextureUrls);
    
    // Create skybox mesh for rotatable environment
    const skyboxGeo = new THREE.BoxGeometry(1000, 1000, 1000);
    const skyboxMat = new THREE.MeshBasicMaterial({
      envMap: cubeTexture,
      side: THREE.BackSide
    });
    skybox = new THREE.Mesh(skyboxGeo, skyboxMat);
    scene.add(skybox);
    
    // Use cube texture for environment reflections
    scene.environment = cubeTexture;
    cubeCamera.update(re, scene);
    document.body.classList.remove('loading');
  }
  await loadTextures();

  const segments1 = 140;
  const segments2 = 32;
  const sphere = new THREE.SphereGeometry(4.5, segments1, segments1);
  const teaPot = new TeapotGeometry(3, segments2);
  const torus = new THREE.TorusGeometry(3, 1.5, segments1, segments1);
  const torusKnot = new THREE.TorusKnotGeometry(2.5, 0.8, segments1, segments1);
  const geometries = [torusKnot, teaPot, sphere, torus];

  const gltfLoader = new GLTFLoader();
  let loadedModel: THREE.Group | null = null;
  let modelGeometry: THREE.BufferGeometry | null = null;
  let mixer: THREE.AnimationMixer | null = null;

  const particleTexture = new THREE.TextureLoader().load('/particle.png');

  let meshGeo: THREE.BufferGeometry = geometries[0];

  async function loadGLBModel(modelPath: string) {
    const gltf = await gltfLoader.loadAsync(modelPath);
    loadedModel = gltf.scene;
    const modelMesh = loadedModel.children[0] as THREE.Mesh;
    if (modelMesh && modelMesh.geometry) {
      modelGeometry = modelMesh.geometry;
      handleMeshChange(modelGeometry);
    }
    // Ensure animations loop
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(loadedModel);
      gltf.animations.forEach((clip) => {
        const action = mixer!.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      });
    }
  }

  const phyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x636363),
    metalness: 2.0,
    roughness: 0.0,
    side: THREE.DoubleSide,
  });

  const dissolveUniformData = {
    uEdgeColor: { value: new THREE.Color(0x4d9bff) },
    uFreq: { value: 0.5 },
    uAmp: { value: 5 },
    uProgress: { value: 0 },
    uEdge: { value: 2.5 },
  } as const;

  function setupUniforms(shader: any, uniforms: { [k: string]: any }) {
    Object.keys(uniforms).forEach((key) => {
      shader.uniforms[key] = uniforms[key];
    });
  }

  function setupDissolveShader(shader: any) {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n varying vec3 vPos;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n vPos = position;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n varying vec3 vPos;\n uniform float uFreq; uniform float uAmp; uniform float uProgress; uniform float uEdge; uniform vec3 uEdgeColor;\n ${snoise}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n float noise = snoise(vPos * uFreq) * uAmp; if(noise < uProgress) discard; float edgeWidth = uProgress + uEdge; if(noise > uProgress && noise < edgeWidth){ gl_FragColor = vec4(vec3(uEdgeColor),noise);}else{ gl_FragColor = vec4(gl_FragColor.xyz,1.0);} `);
  }

  phyMat.onBeforeCompile = (shader) => { setupUniforms(shader, dissolveUniformData as any); setupDissolveShader(shader); };

  let mesh: THREE.Object3D = new THREE.Mesh(meshGeo, phyMat);
  scene.add(mesh);

  let particleMesh: THREE.Points;
  let particleCount = (meshGeo.attributes.position as THREE.BufferAttribute).count;
  let particleMaxOffsetArr: Float32Array;
  let particleInitPosArr: Float32Array;
  let particleCurrPosArr: Float32Array;
  let particleVelocityArr: Float32Array;
  let particleDistArr: Float32Array;
  let particleRotationArr: Float32Array;

  const particleData = { particleSpeedFactor: 0.02, velocityFactor: { x: 2.5, y: 2 }, waveAmplitude: 0 } as any;

  function initParticleAttributes(geo: THREE.BufferGeometry) {
    particleCount = (geo.attributes.position as THREE.BufferAttribute).count;
    particleMaxOffsetArr = new Float32Array(particleCount);
    particleInitPosArr = new Float32Array((geo.getAttribute('position') as THREE.BufferAttribute).array);
    particleCurrPosArr = new Float32Array((geo.getAttribute('position') as THREE.BufferAttribute).array);
    particleVelocityArr = new Float32Array(particleCount * 3);
    particleDistArr = new Float32Array(particleCount);
    particleRotationArr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const x = i * 3 + 0, y = i * 3 + 1, z = i * 3 + 2;
      particleMaxOffsetArr[i] = Math.random() * 5.5 + 1.5;
      particleVelocityArr[x] = Math.random() * 0.5 + 0.5;
      particleVelocityArr[y] = Math.random() * 0.5 + 0.5;
      particleVelocityArr[z] = Math.random() * 0.1;
      particleDistArr[i] = 0.001;
      particleRotationArr[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute('aOffset', new THREE.BufferAttribute(particleMaxOffsetArr, 1));
    geo.setAttribute('aCurrentPos', new THREE.BufferAttribute(particleCurrPosArr, 3));
    geo.setAttribute('aVelocity', new THREE.BufferAttribute(particleVelocityArr, 3));
    geo.setAttribute('aDist', new THREE.BufferAttribute(particleDistArr, 1));
    geo.setAttribute('aAngle', new THREE.BufferAttribute(particleRotationArr, 1));
  }

  function calculateWaveOffset(idx: number) {
    const posx = particleCurrPosArr[idx * 3 + 0];
    const posy = particleCurrPosArr[idx * 3 + 1];
    const xwave1 = Math.sin(posy * 2) * (0.8 + particleData.waveAmplitude);
    const ywave1 = Math.sin(posx * 2) * (0.6 + particleData.waveAmplitude);
    const xwave2 = Math.sin(posy * 5) * (0.2 + particleData.waveAmplitude);
    const ywave2 = Math.sin(posx * 1) * (0.9 + particleData.waveAmplitude);
    const xwave3 = Math.sin(posy * 8) * (0.8 + particleData.waveAmplitude);
    const ywave3 = Math.sin(posx * 5) * (0.6 + particleData.waveAmplitude);
    const xwave4 = Math.sin(posy * 3) * (0.8 + particleData.waveAmplitude);
    const ywave4 = Math.sin(posx * 7) * (0.6 + particleData.waveAmplitude);
    return { xwave: xwave1 + xwave2 + xwave3 + xwave4, ywave: ywave1 + ywave2 + ywave3 + ywave4 };
  }

  function updateVelocity(idx: number) {
    let vx = particleVelocityArr[idx * 3 + 0];
    let vy = particleVelocityArr[idx * 3 + 1];
    let vz = particleVelocityArr[idx * 3 + 2];
    vx *= particleData.velocityFactor.x; vy *= particleData.velocityFactor.y;
    const { xwave, ywave } = calculateWaveOffset(idx);
    vx += xwave; vy += ywave;
    vx *= Math.abs(particleData.particleSpeedFactor);
    vy *= Math.abs(particleData.particleSpeedFactor);
    vz *= Math.abs(particleData.particleSpeedFactor);
    return { vx, vy, vz };
  }

  function updateParticleAttriutes() {
    for (let i = 0; i < particleCount; i++) {
      const x = i * 3 + 0, y = i * 3 + 1, z = i * 3 + 2;
      const { vx, vy, vz } = updateVelocity(i);
      particleCurrPosArr[x] += vx; particleCurrPosArr[y] += vy; particleCurrPosArr[z] += vz;
      const vec1 = new THREE.Vector3(particleInitPosArr[x], particleInitPosArr[y], particleInitPosArr[z]);
      const vec2 = new THREE.Vector3(particleCurrPosArr[x], particleCurrPosArr[y], particleCurrPosArr[z]);
      const dist = vec1.distanceTo(vec2);
      particleDistArr[i] = dist; particleRotationArr[i] += 0.01;
      if (dist > particleMaxOffsetArr[i]) { particleCurrPosArr[x] = particleInitPosArr[x]; particleCurrPosArr[y] = particleInitPosArr[y]; particleCurrPosArr[z] = particleInitPosArr[z]; }
    }
    meshGeo.setAttribute('aOffset', new THREE.BufferAttribute(particleMaxOffsetArr, 1));
    meshGeo.setAttribute('aCurrentPos', new THREE.BufferAttribute(particleCurrPosArr, 3));
    meshGeo.setAttribute('aVelocity', new THREE.BufferAttribute(particleVelocityArr, 3));
    meshGeo.setAttribute('aDist', new THREE.BufferAttribute(particleDistArr, 1));
    meshGeo.setAttribute('aAngle', new THREE.BufferAttribute(particleRotationArr, 1));
  }

  initParticleAttributes(meshGeo);

  const particlesUniformData: any = {
    uTexture: { value: particleTexture },
    uPixelDensity: { value: re.getPixelRatio() },
    uProgress: dissolveUniformData.uProgress,
    uEdge: dissolveUniformData.uEdge,
    uAmp: dissolveUniformData.uAmp,
    uFreq: dissolveUniformData.uFreq,
    uBaseSize: { value: 100 },
    uColor: { value: new THREE.Color(0x4d9bff) },
  };

  const particleMatVertex = `\n ${snoise}\n uniform float uPixelDensity; uniform float uBaseSize; uniform float uFreq; uniform float uAmp; uniform float uEdge; uniform float uProgress; varying float vNoise; varying float vAngle; attribute vec3 aCurrentPos; attribute float aDist; attribute float aAngle; void main(){ vec3 pos = position; float noise = snoise(pos * uFreq) * uAmp; vNoise = noise; vAngle = aAngle; if( vNoise > uProgress-2.0 && vNoise < uProgress + uEdge+2.0){ pos = aCurrentPos; } vec4 modelPosition = modelMatrix * vec4(pos, 1.0); vec4 viewPosition = viewMatrix * modelPosition; vec4 projectedPosition = projectionMatrix * viewPosition; gl_Position = projectedPosition; float size = uBaseSize * uPixelDensity; size = size / (aDist + 1.0); gl_PointSize = size / -viewPosition.z; }`;
  const particleMatFragment = `uniform vec3 uColor; uniform float uEdge; uniform float uProgress; uniform sampler2D uTexture; varying float vNoise; varying float vAngle; void main(){ if( vNoise < uProgress ) discard; if( vNoise > uProgress + uEdge) discard; vec2 coord = gl_PointCoord; coord = coord - 0.5; coord = coord * mat2(cos(vAngle),sin(vAngle), -sin(vAngle), cos(vAngle)); coord = coord + 0.5; vec4 texture = texture2D(uTexture,coord); gl_FragColor = vec4(vec3(uColor.xyz * texture.xyz),1.0); }`;

  const particleShaderMat = new THREE.ShaderMaterial({ uniforms: particlesUniformData, vertexShader: particleMatVertex, fragmentShader: particleMatFragment, transparent: true, blending: THREE.AdditiveBlending });

  let particleGeo = meshGeo;
  particleMesh = new THREE.Points(particleGeo, particleShaderMat);
  scene.add(particleMesh);

  function handleMeshChange(geo: THREE.BufferGeometry) {
    scene.remove(mesh);
    scene.remove(particleMesh);
    meshGeo = geo;
    geo.scale(0.2, 0.2, 0.2);
    mesh = new THREE.Mesh(geo, phyMat);
    initParticleAttributes(geo);
    particleGeo = geo;
    particleMesh = new THREE.Points(geo, particleShaderMat);
    scene.add(mesh);
    scene.add(particleMesh);
  }

  // load aura.glb from public and loop its animation
  await loadGLBModel('/aura.glb');
  
//   const tweaks: any = { meshVisible: true, dissolveProgress: dissolveUniformData.uProgress.value, edgeWidth: dissolveUniformData.uEdge.value, amplitude: dissolveUniformData.uAmp.value, frequency: dissolveUniformData.uFreq.value, meshColor: '#' + (new THREE.Color(0x636363)).getHexString(), edgeColor: '#' + (new THREE.Color(0x4d9bff)).getHexString(), autoDissolve: false };
  
//   const particleTweaks: any = { particleVisible: true, particleBaseSize: particlesUniformData.uBaseSize.value, particleColor: '#' + (particlesUniformData.uColor.value as THREE.Color).getHexString(), particleSpeedFactor: 0.075, velocityFactor: { x: 5, y: 5 }, waveAmplitude: 2.35 };
  
  function resizeRendererToDisplaySize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      re.setSize(width, height, false);
      renderPass.setSize(width, height);
      outPass.setSize(width, height);
      unrealBloomPass.setSize(width, height);
      effectComposer1.setSize(width, height);
      effectComposer2.setSize(width, height);
    }
    return needResize;
  }

  let dissolving = true;
  function animateDissolve() {
    const progress = (dissolveUniformData as any).uProgress;
    // const tweaks: any = (window as any).__dissolveTweaks;
    // console.log(`tweaks:`, tweaks);
    // if (tweaks?.autoDissolve) {
    // console.log(`progress.value:`, progress.value);
      if (dissolving) progress.value += 0.08; else progress.value -= 0.08;
      if (progress.value > 8 && dissolving) dissolving = false;
      if (progress.value < -7 && !dissolving) dissolving = true;
    // }
  }

  const clock = new THREE.Clock();
  let rafId = 0;
  function animate() {
    orbCtrls.update();
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    updateParticleAttriutes();
    animateDissolve();
    
    if (resizeRendererToDisplaySize()) {
      const c = re.domElement; cam.aspect = c.clientWidth / c.clientHeight; cam.updateProjectionMatrix();
    }
    // scene.background = blackColor;
    effectComposer1.render();
    // scene.background = blackColor;
    // scene.background = cubeTexture; 
    effectComposer2.render();
    rafId = requestAnimationFrame(animate);
  }
  rafId = requestAnimationFrame(animate);

  window.addEventListener('orientationchange', reload, { passive: true });
  function reload() { location.reload(); }

  return () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('orientationchange', reload as any);
    re.dispose();
  };
}


