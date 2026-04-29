import * as THREE from 'https://esm.sh/three@0.164.1';
import { OrbitControls } from 'https://esm.sh/three@0.164.1/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'https://esm.sh/three@0.164.1/examples/jsm/loaders/PLYLoader.js';

let plyViewersInitialized = false;

function initPlyViewers() {
  if (plyViewersInitialized) {
    return;
  }

  const viewerElements = Array.from(document.querySelectorAll('.ply-viewer'));

  if (!viewerElements.length) {
    return;
  }

  plyViewersInitialized = true;
  const loader = new PLYLoader();
  const allViewers = [];
  const viewerGroups = new Map();
  let isSyncing = false;
  let animationStarted = false;
  const pointSize = 0.1;
  const colorBrightness = 2.5;
  const autoRotateResumeDelay = 3500;
  const autoRotateResumeTimers = new Map();

  function resizeViewer(viewer) {
    const rect = viewer.container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    viewer.camera.aspect = width / height;
    viewer.camera.updateProjectionMatrix();
    viewer.renderer.setSize(width, height, false);
  }

  function syncView(sourceViewer) {
    if (isSyncing) {
      return;
    }

    isSyncing = true;
    sourceViewer.groupViewers.forEach((viewer) => {
      if (viewer === sourceViewer) {
        return;
      }

      viewer.camera.position.copy(sourceViewer.camera.position);
      viewer.camera.quaternion.copy(sourceViewer.camera.quaternion);
      viewer.camera.zoom = sourceViewer.camera.zoom;
      viewer.camera.updateProjectionMatrix();
      viewer.controls.target.copy(sourceViewer.controls.target);
      viewer.controls.update();
    });
    isSyncing = false;
  }

  function createPointTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  const pointTexture = createPointTexture();

  function brightenVertexColors(geometry) {
    const colorAttribute = geometry.getAttribute('color');

    if (!colorAttribute || colorBrightness === 1) {
      return;
    }

    const colors = new Float32Array(colorAttribute.count * 3);
    const source = colorAttribute.array;
    let maxColorValue = 1;

    for (let i = 0; i < source.length; i++) {
      maxColorValue = Math.max(maxColorValue, source[i]);
    }

    const divisor = maxColorValue > 1 ? 255 : 1;

    for (let i = 0; i < colorAttribute.count; i++) {
      colors[i * 3] = Math.min(1, (colorAttribute.getX(i) / divisor) * colorBrightness);
      colors[i * 3 + 1] = Math.min(1, (colorAttribute.getY(i) / divisor) * colorBrightness);
      colors[i * 3 + 2] = Math.min(1, (colorAttribute.getZ(i) / divisor) * colorBrightness);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }

  function addPointCloud(viewer, geometry, alignment) {
    brightenVertexColors(geometry);
    geometry.computeBoundingBox();

    const center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);

    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(alignment.scale, alignment.scale, alignment.scale);
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      size: pointSize,
      map: pointTexture,
      vertexColors: geometry.hasAttribute('color'),
      color: 0xffffff,
      sizeAttenuation: true,
      transparent: true,
      alphaTest: 0.45,
      depthTest: true,
      depthWrite: true
    });

    const cloud = new THREE.Points(geometry, material);
    viewer.scene.add(cloud);
    viewer.container.classList.add('is-loaded');
  }

  function loadGeometry(path) {
    return new Promise((resolve, reject) => {
      loader.load(path, resolve, undefined, reject);
    });
  }

  function getAlignment(geometries) {
    const referenceGeometry = geometries[geometries.length - 1];
    referenceGeometry.computeBoundingBox();

    const referenceSize = new THREE.Vector3();
    referenceGeometry.boundingBox.getSize(referenceSize);

    const maxSide = Math.max(referenceSize.x, referenceSize.y, referenceSize.z) || 1;

    return {
      scale: 1 / maxSide
    };
  }

  function clearAutoRotateResumeTimer(groupName) {
    const timer = autoRotateResumeTimers.get(groupName);

    if (timer) {
      clearTimeout(timer);
      autoRotateResumeTimers.delete(groupName);
    }
  }

  function pauseGroupAutoRotate(viewer) {
    clearAutoRotateResumeTimer(viewer.groupName);

    viewer.groupViewers.forEach((groupViewer) => {
      groupViewer.controls.autoRotate = false;
      groupViewer.container.classList.add('has-interacted');
    });
  }

  function scheduleGroupAutoRotateResume(viewer) {
    clearAutoRotateResumeTimer(viewer.groupName);

    const timer = setTimeout(() => {
      viewer.groupViewers.forEach((groupViewer) => {
        groupViewer.controls.autoRotate = true;
        groupViewer.container.classList.remove('has-interacted');
      });
      autoRotateResumeTimers.delete(viewer.groupName);
    }, autoRotateResumeDelay);

    autoRotateResumeTimers.set(viewer.groupName, timer);
  }

  viewerElements.forEach((container) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f8fb);
    scene.fog = new THREE.Fog(0xf7f8fb, 2.9, 4.4);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0.22, 0.14, 2.05);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(1.35, 12, 0xc9d2df, 0xe4e8ef);
    grid.position.y = -0.58;
    grid.material.transparent = true;
    grid.material.opacity = 0.34;
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.45;
    controls.minDistance = 0.9;
    controls.maxDistance = 4.0;
    controls.target.set(0, 0, 0);
    controls.update();

    const groupName = container.dataset.syncGroup || 'default';
    if (!viewerGroups.has(groupName)) {
      viewerGroups.set(groupName, []);
    }

    const groupViewers = viewerGroups.get(groupName);
    const viewer = { container, scene, camera, renderer, controls, groupViewers, groupName };
    groupViewers.push(viewer);
    allViewers.push(viewer);

    controls.addEventListener('start', () => {
      pauseGroupAutoRotate(viewer);
      container.classList.add('is-interacting');
      syncView(viewer);
    });
    controls.addEventListener('end', () => {
      container.classList.remove('is-interacting');
      scheduleGroupAutoRotateResume(viewer);
    });
    controls.addEventListener('change', () => syncView(viewer));

    resizeViewer(viewer);
  });

  viewerGroups.forEach((groupViewers) => {
    Promise.all(
      groupViewers.map((viewer) => loadGeometry(viewer.container.dataset.ply))
    )
      .then((geometries) => {
        const alignment = getAlignment(geometries);

        geometries.forEach((geometry, index) => {
          addPointCloud(groupViewers[index], geometry, alignment);
        });
      })
      .catch(() => {
        groupViewers.forEach((viewer) => {
          viewer.container.dataset.label = `${viewer.container.dataset.label} - unavailable`;
        });
      });
  });

  const resizeObserver = new ResizeObserver(() => {
    allViewers.forEach(resizeViewer);
  });
  viewerElements.forEach((element) => resizeObserver.observe(element));

  function animate() {
    allViewers.forEach((viewer) => {
      viewer.controls.update();
      viewer.renderer.render(viewer.scene, viewer.camera);
    });
    requestAnimationFrame(animate);
  }

  if (!animationStarted) {
    animationStarted = true;
    animate();
  }
}

const qualitativeWrapper = document.querySelector('.qualitative-wrapper');
if (qualitativeWrapper && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      initPlyViewers();
      observer.disconnect();
    }
  }, {
    rootMargin: '350px 0px'
  });

  observer.observe(qualitativeWrapper);
} else {
  initPlyViewers();
}
