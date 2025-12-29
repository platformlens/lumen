import React from 'react';
import { motion } from 'framer-motion';


interface BottomPanelProps {
    isVisible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    height?: string | number;
}

export const BottomPanel: React.FC<BottomPanelProps> = ({ 
    isVisible, 
    children, 
    height = '40%' 
}) => {
    return (
        <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ 
                height: isVisible ? height : 0, 
                opacity: isVisible ? 1 : 0 
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex flex-col border-t border-white/10 bg-[#1e1e1e] shadow-[0_-4px_20px_rgba(0,0,0,0.5)] z-40 overflow-hidden"
        >
           {/* Standard Header (if needed, but usually the child content like LogViewer has its own header) */}
           {/* For now we assume children fill the space */}
           <div className="flex-1 overflow-hidden relative">
               {children}
           </div>
        </motion.div>
    );
};
