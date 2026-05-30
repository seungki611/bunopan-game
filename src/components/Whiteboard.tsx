import { useRef, useEffect, useState, useImperativeHandle, forwardRef, MouseEvent, TouchEvent } from "react";
import { Trash2, ShieldAlert, Eraser, Edit2 } from "lucide-react";

export interface WhiteboardRef {
  getImageDataUrl: () => string;
  clearCanvas: () => void;
}

interface WhiteboardProps {
  disabled?: boolean;
}

const COLORS = [
  { name: "Charcoal", hex: "#1e293b" },
  { name: "Red", hex: "#ef4444" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Green", hex: "#10b981" },
];

const BRUSH_SIZES = [
  { label: "얇게", value: 3 },
  { label: "보통", value: 6 },
  { label: "두껍게", value: 12 },
];

export const Whiteboard = forwardRef<WhiteboardRef, WhiteboardProps>(({ disabled = false }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const [color, setColor] = useState("#1e293b");
  const [brushSize, setBrushSize] = useState(6);
  const [isEraser, setIsEraser] = useState(false);

  // Expose clear and get methods
  useImperativeHandle(ref, () => ({
    getImageDataUrl: () => {
      const canvas = canvasRef.current;
      if (!canvas) return "";
      
      // We want to create a canvas that has a white background for high legibility
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx) {
        tempCtx.fillStyle = "#ffffff";
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, 0, 0);
        return tempCanvas.toDataURL("image/png");
      }
      return canvas.toDataURL("image/png");
    },
    clearCanvas: () => {
      clear();
    }
  }));

  const getCoordinates = (e: MouseEvent | TouchEvent | Touch | { clientX: number, clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Support scale ratio if matching CSS vs actual canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.strokeStyle = isEraser ? "#ffffff" : color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  // Mouse handlers
  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    isDrawing.current = true;
    lastPos.current = getCoordinates(e);
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || disabled) return;
    const currentPos = getCoordinates(e);
    drawLine(lastPos.current.x, lastPos.current.y, currentPos.x, currentPos.y);
    lastPos.current = currentPos;
  };

  const handleMouseUpOrLeave = () => {
    isDrawing.current = false;
  };

  // Touch handlers (Mobile support)
  const handleTouchStart = (e: TouchEvent<HTMLCanvasElement>) => {
    if (disabled || e.touches.length === 0) return;
    isDrawing.current = true;
    const touch = e.touches[0];
    lastPos.current = getCoordinates(touch);
  };

  const handleTouchMove = (e: TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || disabled || e.touches.length === 0) return;
    // Prevent scrolling when drawing
    if (e.cancelable) e.preventDefault();
    const touch = e.touches[0];
    const currentPos = getCoordinates(touch);
    drawLine(lastPos.current.x, lastPos.current.y, currentPos.x, currentPos.y);
    lastPos.current = currentPos;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  // Auto resize setup as required by standard responsiveness canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      // Save content
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx) {
        tempCtx.drawImage(canvas, 0, 0);
      }

      // Resize
      const rect = container.getBoundingClientRect();
      const newWidth = Math.max(rect.width, 300);
      const newHeight = 320; // fixed relative drawing height
      
      canvas.width = newWidth;
      canvas.height = newHeight;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, newWidth, newHeight);
        ctx.drawImage(tempCanvas, 0, 0);
      }
    };

    resizeCanvas();

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col space-y-3 w-full" ref={containerRef}>
      {/* Tool panel */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-100 rounded-xl border-3 border-slate-900 shadow-[3px_3px_0px_#1e293b]">
        <div className="flex items-center space-x-2">
          {/* Mode Switchers */}
          <button
            type="button"
            onClick={() => setIsEraser(false)}
            className={`p-2.5 rounded-lg transition-all duration-100 border-2 border-slate-900 ${
              !isEraser ? "bg-slate-900 text-white shadow-none translate-y-0" : "bg-white hover:bg-slate-200 text-slate-700 shadow-[2px_2px_0px_#1e293b]"
            }`}
            title="연필"
          >
            <Edit2 className="w-4 h-4 font-bold" />
          </button>
          <button
            type="button"
            onClick={() => setIsEraser(true)}
            className={`p-2.5 rounded-lg transition-all duration-100 border-2 border-slate-900 ${
              isEraser ? "bg-slate-900 text-white shadow-none translate-y-0" : "bg-white hover:bg-slate-200 text-slate-700 shadow-[2px_2px_0px_#1e293b]"
            }`}
            title="지우개"
          >
            <Eraser className="w-4 h-4 font-bold" />
          </button>

          <span className="h-6 w-px bg-slate-300 mx-1" />

          {/* Color Palletes */}
          <div className="flex items-center space-x-2">
            {COLORS.map((col) => (
              <button
                key={col.hex}
                type="button"
                onClick={() => {
                  setColor(col.hex);
                  setIsEraser(false);
                }}
                disabled={isEraser}
                style={{ backgroundColor: col.hex }}
                className={`w-6 h-6 rounded-full border-2 border-slate-900 transition-all ${
                  color === col.hex && !isEraser
                    ? "scale-110 ring-2 ring-blue-500 ring-offset-1"
                    : "hover:scale-105"
                } disabled:opacity-30`}
                title={col.name}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Brush Sizes */}
          <div className="flex rounded-lg p-0.5 bg-slate-200 border-2 border-slate-900">
            {BRUSH_SIZES.map((sz) => (
              <button
                key={sz.value}
                type="button"
                onClick={() => setBrushSize(sz.value)}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                  brushSize === sz.value
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:text-slate-900"
                }`}
              >
                {sz.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={clear}
            className="flex items-center space-x-1 px-3 py-1.5 text-xs text-rose-600 font-extrabold hover:bg-rose-50 border-2 border-rose-600 rounded-lg transition-all shadow-[2px_2px_0px_#e11d48] active:translate-y-0.5 active:shadow-none"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>비우기</span>
          </button>
        </div>
      </div>

      {/* Canvas Wrap */}
      <div className="relative border-4 border-slate-900 rounded-2xl overflow-hidden bg-white shadow-2xl whiteboard-surface">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUpOrLeave}
          className="block w-full touch-none cursor-crosshair bg-transparent"
          style={{ height: "320px" }}
        />

        {disabled && (
          <div className="absolute inset-0 bg-slate-900/5 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-white/95 border border-slate-200 rounded-full shadow-md text-xs font-semibold text-slate-600">
              <ShieldAlert className="w-4 h-4 text-amber-500 animate-pulse" />
              <span>정답 대기중 또는 잠금됨</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

Whiteboard.displayName = "Whiteboard";
