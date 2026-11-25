/* Detailed 3D interpretation of the supplied Shiro NFT rocket. Crash timing and trajectory remain owned by index.html. */
(function(){
 const THREE=window.THREE;
 if(!THREE)return;
 function initCrash3D(){
  const wrap=document.querySelector('.crash-canvas-wrap');if(!wrap)return;
  if(crash3D){crash3D.renderer.setSize(wrap.clientWidth,wrap.clientHeight,false);crash3D.camera.aspect=wrap.clientWidth/Math.max(1,wrap.clientHeight);crash3D.camera.updateProjectionMatrix();return;}
  let renderer;try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});}catch(e){console.warn('[Crash NFT rocket] WebGL fallback',e);return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(wrap.clientWidth,wrap.clientHeight,false);renderer.setClearColor(0,0);renderer.domElement.className='crash-3d-canvas';wrap.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,wrap.clientWidth/Math.max(1,wrap.clientHeight),.1,100);camera.position.z=8.5;
  scene.add(new THREE.AmbientLight(0xe9efff,1.08));
  const key=new THREE.DirectionalLight(0xffedc4,1.35);key.position.set(-3,4,6);scene.add(key);
  const fill=new THREE.DirectionalLight(0x71c8f2,.82);fill.position.set(3,-1,4);scene.add(fill);
  const rim=new THREE.PointLight(0x5bb9ed,.9,12);rim.position.set(2,-1,3);scene.add(rim);
  const rocket=new THREE.Group();rocket.scale.setScalar(.78);scene.add(rocket);
  const profile=[new THREE.Vector2(0,-1.12),new THREE.Vector2(.16,-1.09),new THREE.Vector2(.30,-.94),new THREE.Vector2(.405,-.69),new THREE.Vector2(.465,-.34),new THREE.Vector2(.47,.12),new THREE.Vector2(.42,.52),new THREE.Vector2(.32,.84),new THREE.Vector2(.18,1.08),new THREE.Vector2(0,1.16)];
  const hullGeo=new THREE.LatheGeometry(profile,96),rgb=[],v=hullGeo.attributes.position;
  for(let i=0;i<v.count;i++){
   const x=v.getX(i),z=v.getZ(i),side=x/.47,front=Math.max(0,z/.47);
   const gold=new THREE.Color(0xd8c995),dark=new THREE.Color(0x24262b),ice=new THREE.Color(0x79c4df);
   let c=dark.clone();
   if(side<-.18)c.lerp(gold,Math.min(1,(-side-.18)/.68)*.98);
   if(side>.18)c.lerp(ice,Math.min(1,(side-.18)/.68)*.92);
   c.multiplyScalar(.78+front*.24);rgb.push(c.r,c.g,c.b);
  }
  hullGeo.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3));
  const hull=new THREE.Mesh(hullGeo,new THREE.MeshPhysicalMaterial({vertexColors:true,metalness:.12,roughness:.5,clearcoat:.22,clearcoatRoughness:.48}));rocket.add(hull);
  const metal=new THREE.MeshStandardMaterial({color:0x25272d,metalness:.22,roughness:.46});
  const blue=new THREE.MeshStandardMaterial({color:0x52617f,metalness:.18,roughness:.43});
  const cyan=new THREE.MeshStandardMaterial({color:0x56b5d5,metalness:.12,roughness:.34,emissive:0x092b3c,emissiveIntensity:.2});
  const green=new THREE.MeshStandardMaterial({color:0x75b83d,roughness:.42,emissive:0x284b0d,emissiveIntensity:.45});
  // Dark central longitudinal inset and slim raised rails.
  function strip(points,material,z,bevel=.012){
   const curve=new THREE.CatmullRomCurve3(points.map(q=>new THREE.Vector3(q[0],q[1],z)));
   rocket.add(new THREE.Mesh(new THREE.TubeGeometry(curve,64,bevel,8,false),material));
  }
  strip([[-.16,-.98],[-.20,-.55],[-.16,-.10],[-.08,.40],[.04,.83]],metal,.405,.035);
  strip([[.25,-.90],[.36,-.54],[.39,-.06],[.32,.42],[.18,.88]],cyan,.27,.018);
  strip([[-.30,-.78],[-.38,-.40],[-.39,.02],[-.28,.48],[-.12,.91]],blue,.25,.018);
  // Raised narrow blue-grey decorative panels on the hull.
  function panel(points,mat,z){const s=new THREE.Shape();s.moveTo(points[0][0],points[0][1]);points.slice(1).forEach(p=>s.lineTo(p[0],p[1]));s.closePath();const m=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:.025,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.014,bevelThickness:.012}),mat);m.position.z=z;rocket.add(m);}
  panel([[-.37,-.70],[-.24,-.91],[-.08,-.43],[.02,-.10],[-.10,.02],[-.24,-.24]],blue,.42);
  panel([[.18,.53],[.30,.86],[.43,1.06],[.36,.70],[.25,.48]],blue,.36);
  // Thin dark seam, collar and tail hardware.
  strip([[-.31,-.93],[-.39,-.63],[-.42,-.22]],metal,.25,.022);
  const collar=new THREE.Mesh(new THREE.TorusGeometry(.36,.022,10,64),metal);collar.rotation.x=Math.PI/2;collar.position.y=-.83;rocket.add(collar);
  const nozzleRing=new THREE.Mesh(new THREE.TorusGeometry(.27,.052,12,56),metal);nozzleRing.rotation.x=Math.PI/2;nozzleRing.position.y=-1.02;rocket.add(nozzleRing);
  const nozzleInner=new THREE.Mesh(new THREE.CylinderGeometry(.16,.21,.14,48),new THREE.MeshStandardMaterial({color:0x11151c,metalness:.15,roughness:.55}));nozzleInner.position.y=-1.07;rocket.add(nozzleInner);
  // Small panel bolts and rivets.
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2;const bolt=new THREE.Mesh(new THREE.SphereGeometry(.014,8,6),i%3===0?cyan:metal);bolt.position.set(Math.cos(a)*.38,-.68+(i%4)*.36,Math.sin(a)*.20+.22);rocket.add(bolt);}
  // Green glowing shard fragments floating beside the rocket.
  const shards=[];
  for(let i=0;i<3;i++){const s=new THREE.Shape();s.moveTo(0,.12);s.lineTo(.055,.04);s.lineTo(.03,-.12);s.lineTo(-.035,-.065);s.closePath();const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:.035,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.012,bevelThickness:.012}),green);mesh.position.set(i===0?-.64:i===1?.62:.47,i===0?.34:i===1?-.10:-.72,.12);mesh.rotation.z=i*.75-.25;rocket.add(mesh);shards.push({mesh,phase:i*2.1});const glow=new THREE.PointLight(0x8cdb43,.24,1.1);glow.position.copy(mesh.position);rocket.add(glow);}
  // Exhaust is built from rounded orange combustion lobes like the supplied NFT image.
  const puffs=[],fireCols=[0xff8500,0xffa000,0xffbd19,0xffd64b];
  for(let i=0;i<17;i++){const a=i*2.399,r=i<10?.17:.09,sx=.075+(i%4)*.02,sy=.085+(i%3)*.024;const m=new THREE.Mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial({color:fireCols[i%4],transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));m.position.set(Math.cos(a)*r,-1.13-(i%6)*.045,.13+Math.sin(a)*.06);m.scale.set(sx,sy,sx*.82);rocket.add(m);puffs.push({m,sx,sy,phase:i*1.43});}
  const flame=new THREE.Mesh(new THREE.ConeGeometry(.20,.72,32),new THREE.MeshBasicMaterial({color:0xff7910,transparent:true,opacity:.82,blending:THREE.AdditiveBlending,depthWrite:false}));flame.rotation.z=Math.PI;flame.position.set(0,-1.43,.10);rocket.add(flame);
  const core=new THREE.Mesh(new THREE.ConeGeometry(.105,.50,28),new THREE.MeshBasicMaterial({color:0xffe6a0,transparent:true,opacity:.96,blending:THREE.AdditiveBlending,depthWrite:false}));core.rotation.z=Math.PI;core.position.set(0,-1.39,.14);rocket.add(core);
  // 112 individually animated embers of varied sizes, hues and trajectories.
  const count=112,dummy=new THREE.Object3D(),data=[],colors=[0xff4a08,0xff7910,0xffaa1e,0xffd34b,0xffedaa].map(c=>new THREE.Color(c));
  const sparks=new THREE.InstancedMesh(new THREE.SphereGeometry(.026,7,5),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}),count);
  for(let i=0;i<count;i++){data.push({seed:i*12.9898,phase:(i*.61803398875)%1,speed:.7+(i%11)*.082,spread:.10+(i%13)*.023});if(sparks.setColorAt)sparks.setColorAt(i,colors[i%colors.length]);}
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);rocket.add(sparks);
  const flight=new THREE.Group();flight.add(rocket);scene.add(flight);
  crash3D={renderer,scene,camera,flight,rocket,flame,core,puffs,shards,sparks,dummy,data};
 }
 function updateCrash3D(t,flying){
  if(!crash3D)return;const now=performance.now(),sec=now*.001;
  crash3D.flight.rotation.z=-crashHeading(t)-Math.PI/2;
  crash3D.rocket.rotation.y=now*(flying?.0028:.00065);
  const pulse=flying?1+Math.sin(now/48)*.2:.68+Math.sin(now/240)*.04;
  crash3D.flame.scale.set(1,pulse,1);crash3D.core.scale.set(1,1+Math.sin(now/37)*.16,1);
  crash3D.puffs.forEach(p=>{const f=.82+.22*Math.sin(sec*14+p.phase);p.m.scale.set(p.sx*f,p.sy*f,p.sx*.82*f);p.m.material.opacity=(flying?.88:.2)+Math.sin(sec*10+p.phase)*.05;});
  crash3D.shards.forEach(s=>{s.mesh.position.y+=Math.sin(sec*3+s.phase)*.0008;s.mesh.rotation.z+=.002;});
  const d=crash3D.dummy;
  for(let i=0;i<crash3D.data.length;i++){const p=crash3D.data[i],age=(p.phase+sec*p.speed*(flying?1.7:.34))%1,spread=p.spread*(.2+age*2.3),side=Math.sin(p.seed+sec*8)*spread,jitter=Math.cos(p.seed*.71+sec*11)*.045;d.position.set(side+jitter,-1.17-age*(flying?1.12:.23),.12+.11*Math.sin(p.seed+sec*6));const size=(.009+.032*(1-age))*(flying?1:.2);d.scale.set(size*(.7+(i%3)*.2),size*(.9+(i%4)*.2),size);d.rotation.set(sec*2+p.seed,sec*1.4+p.seed*.4,sec*3+p.seed);d.updateMatrix();crash3D.sparks.setMatrixAt(i,d.matrix);}
  crash3D.sparks.instanceMatrix.needsUpdate=true;crash3D.renderer.render(crash3D.scene,crash3D.camera);
 }
 window.initCrash3D=initCrash3D;window.updateCrash3D=updateCrash3D;
})();