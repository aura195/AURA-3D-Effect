'use client';

import { useEffect, useRef } from 'react';

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let disposeScene: (() => void) | null = null;
    async function boot() {
      const mod = await import('../src/appClient');
      disposeScene = await mod.start(canvasRef.current!);
    }
    boot();
    return () => { if (disposeScene) disposeScene(); };
  }, []);

  return (
    <>
      <canvas id="c" ref={canvasRef} className="z-0 absolute w-screen h-screen top-0 left-0 pointer-events-none" />
      {/* <div className="absolute top-0 left-0 w-full h-full bg-black/20 z-10"></div> */}
      {/* <div className="absolute top-0 left-0 w-full h-full z-10">
        <div className="flex flex-col items-center justify-center h-full">
          <h1 className="text-white text-4xl font-bold mb-4">Emissive Dissolve Effect in Three.js</h1>
          <p className="text-white text-base mb-2 text-center max-w-xl">
            A visually striking dissolve effect applied to a 3D text GLB model using custom shaders and Three.js. 
            The effect features animated particles and smooth transitions, demonstrating advanced material and geometry manipulation.
          </p>
          <a href="https://github.com/aura195/AURA-3D-Effect" className="text-white text-sm">GitHub</a>
        </div>
      </div> */}
    </>
  );
}


