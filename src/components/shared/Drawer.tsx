import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check } from 'lucide-react';

// Better approach: Encapsulate the Copy Button entirely
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
      title="Copy title"
    >
      {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
    </button>
  );
};

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, title, children, headerActions }) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  // Track whether the panel exit animation is still running
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  // When isOpen goes from true to false, start animating out
  const prevOpenRef = useRef(isOpen);
  useEffect(() => {
    if (prevOpenRef.current && !isOpen) {
      setIsAnimatingOut(true);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  const handleExitComplete = useCallback(() => {
    setIsAnimatingOut(false);
  }, []);

  // Show the backdrop container when drawer is open OR still animating out
  const showBackdrop = isOpen || isAnimatingOut;

  return (
    <>
      {/* Backdrop - rendered outside AnimatePresence for reliable cleanup */}
      {/* Uses CSS transition instead of framer-motion to avoid ghost element issues */}
      <div
        className={`absolute inset-0 z-40 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          } ${showBackdrop ? 'bg-black/50' : ''}`}
        onClick={isOpen ? onClose : undefined}
        style={{ display: showBackdrop ? 'block' : 'none' }}
      />

      {/* Drawer Panel - uses AnimatePresence for slide animation */}
      <AnimatePresence onExitComplete={handleExitComplete}>
        {isOpen && (
          <motion.div
            key="drawer-panel"
            ref={drawerRef}
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute top-2 right-2 w-[600px] bg-gradient-to-l from-zinc-950/95 to-black/95 backdrop-blur-2xl border border-white/10 shadow-2xl z-[60] flex flex-col rounded-2xl overflow-hidden bottom-4"
          >
            {/* Header */}
            <div className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-white/5">
              <div className="flex items-center gap-2 flex-1 mr-4 overflow-hidden">
                <h2 className="text-xl font-bold text-white truncate">{title}</h2>
                <CopyButton text={title} />
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {headerActions}
                <button onClick={onClose} className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors ml-2">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
