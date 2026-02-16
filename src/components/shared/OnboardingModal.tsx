import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Rocket, Monitor, Cpu, Sparkles, Cloud } from 'lucide-react';
import { GlassButton } from './GlassButton';

export interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    content?: React.ReactNode;
}

interface OnboardingModalProps {
    isOpen: boolean;
    onComplete: () => void;
    steps: OnboardingStep[];
    appVersion: string;
}

const slideVariants = {
    enter: (direction: number) => ({
        x: direction > 0 ? 200 : -200,
        opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({
        x: direction > 0 ? -200 : 200,
        opacity: 0,
    }),
};

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
    isOpen,
    onComplete,
    steps,
    appVersion,
}) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [direction, setDirection] = useState(0);

    const goNext = useCallback(() => {
        if (currentStep < steps.length - 1) {
            setDirection(1);
            setCurrentStep(prev => prev + 1);
        } else {
            onComplete();
        }
    }, [currentStep, steps.length, onComplete]);

    const goPrev = useCallback(() => {
        if (currentStep > 0) {
            setDirection(-1);
            setCurrentStep(prev => prev - 1);
        }
    }, [currentStep]);

    if (!isOpen) return null;

    const step = steps[currentStep];
    const isLastStep = currentStep === steps.length - 1;
    const isFirstStep = currentStep === 0;

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md"
            onClick={onComplete}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="bg-[#141414] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-5 pb-0 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">
                        Lumen v{appVersion}
                    </span>
                    <button
                        onClick={onComplete}
                        className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
                        aria-label="Close onboarding"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Step Content */}
                <div className="relative overflow-hidden min-h-[280px]">
                    <AnimatePresence mode="wait" custom={direction}>
                        <motion.div
                            key={step.id}
                            custom={direction}
                            variants={slideVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.25, ease: 'easeInOut' }}
                            className="p-8 flex flex-col items-center text-center"
                        >
                            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-5 text-blue-400">
                                {step.icon}
                            </div>
                            <h2 className="text-xl font-semibold text-white mb-2">{step.title}</h2>
                            <p className="text-sm text-gray-400 leading-relaxed max-w-sm">
                                {step.description}
                            </p>
                            {step.content && (
                                <div className="mt-5 w-full">{step.content}</div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Footer */}
                <div className="p-5 pt-0 flex items-center justify-between">
                    {/* Step Indicators */}
                    <div className="flex items-center gap-1.5">
                        {steps.map((_, i) => (
                            <div
                                key={i}
                                className={`h-1.5 rounded-full transition-all duration-300 ${i === currentStep
                                        ? 'w-6 bg-blue-500'
                                        : i < currentStep
                                            ? 'w-1.5 bg-blue-500/40'
                                            : 'w-1.5 bg-white/10'
                                    }`}
                            />
                        ))}
                    </div>

                    {/* Navigation */}
                    <div className="flex items-center gap-2">
                        {!isFirstStep && (
                            <GlassButton variant="secondary" onClick={goPrev}>
                                <ChevronLeft size={14} />
                                Back
                            </GlassButton>
                        )}
                        <GlassButton variant="primary" onClick={goNext}>
                            {isLastStep ? 'Get Started' : 'Next'}
                            {!isLastStep && <ChevronRight size={14} />}
                            {isLastStep && <Rocket size={14} />}
                        </GlassButton>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

// Default onboarding steps for new users / new versions
export const DEFAULT_ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: 'welcome',
        title: 'Welcome to Lumen',
        description:
            'A modern Kubernetes management tool designed for speed, clarity, and a great developer experience.',
        icon: <Rocket size={28} />,
    },
    {
        id: 'clusters',
        title: 'Multi-Cluster Management',
        description:
            'Connect to any Kubernetes context from your kubeconfig. Pin your favorite clusters to the title bar for quick switching.',
        icon: <Monitor size={28} />,
    },
    {
        id: 'resources',
        title: 'Real-Time Resource Monitoring',
        description:
            'Watch pods, deployments, nodes, and more update in real time. Dive into details, logs, and YAML with a single click.',
        icon: <Cpu size={28} />,
    },
    {
        id: 'ai',
        title: 'AI-Powered Insights',
        description:
            'Use the built-in AI assistant to explain resources, analyze logs, and troubleshoot issues. Supports Google Gemini and AWS Bedrock.',
        icon: <Sparkles size={28} />,
    },
    {
        id: 'aws',
        title: 'AWS Integration',
        description:
            'Seamless AWS credential detection with Granted support. View EC2 instances, EKS details, and more directly from Lumen.',
        icon: <Cloud size={28} />,
    },
];
