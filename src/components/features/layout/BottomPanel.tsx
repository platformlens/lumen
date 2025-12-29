import React from 'react';
import { motion } from 'framer-motion';


interface BottomPanelProps {
    isVisible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    height?: number; // Simplified to number for controlled state
    onHeightChange?: (height: number) => void;
}

export const BottomPanel: React.FC<BottomPanelProps> = ({ 
    isVisible, 
    children, 
    height = 300,
    onHeightChange
}) => {
    // We use the prop 'height' directly if provided, or fallback to internal state if not (though internal state is less useful now for global layout sync)
    // To support both controlled and uncontrolled usage smoothly, we can track local state initialized from prop, but since we WANT global sync, let's prioritize props.
    // However, App.tsx IS controlling it now.
    
    const [isDragging, setIsDragging] = React.useState(false);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);

        const startY = e.clientY;
        const startHeight = height;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = startY - moveEvent.clientY; // Dragging up increases height
            const newHeight = Math.max(100, Math.min(window.innerHeight - 100, startHeight + deltaY));
            
            if (onHeightChange) {
                onHeightChange(newHeight);
            }
        };

        const handleMouseUp = () => {
             setIsDragging(false);
             document.removeEventListener('mousemove', handleMouseMove);
             document.removeEventListener('mouseup', handleMouseUp);
             document.body.style.userSelect = '';
        };

        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ 
                height: isVisible ? height : 0, 
                opacity: isVisible ? 1 : 0 
            }}
            transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}
            className="flex flex-col border-t border-white/10 bg-[#1e1e1e] shadow-[0_-4px_20px_rgba(0,0,0,0.5)] z-40 overflow-hidden absolute bottom-6 left-0 right-0 w-full"
        >
           {/* Drag Handle */}
           <div 
                onMouseDown={handleMouseDown}
                className="h-1.5 w-full bg-[#252526] hover:bg-blue-500/50 cursor-ns-resize flex items-center justify-center transition-colors group"
           >
               {/* Visual Handle Indicator */}
               <div className="w-16 h-0.5 bg-white/10 group-hover:bg-white/30 rounded-full" />
           </div>

           {/* Content */}
           <div className="flex-1 overflow-hidden relative">
               {children}
           </div>
        </motion.div>
    );
};
