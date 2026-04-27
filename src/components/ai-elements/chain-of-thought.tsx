"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import {
  BrainIcon,
  ChevronDownIcon,
  CircleIcon,
  DotIcon,
  Loader2Icon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import { Shimmer } from "./shimmer";

const MS_IN_S = 1000;
const streamdownPlugins = { cjk, code, math, mermaid };

type ChainOfThoughtContextValue = {
  isStreaming: boolean;
  duration: number | undefined;
};

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null
);

export const useChainOfThought = () => {
  const ctx = useContext(ChainOfThoughtContext);
  if (!ctx) {
    throw new Error(
      "ChainOfThought subcomponents must be used within ChainOfThought"
    );
  }
  return ctx;
};

export type ChainOfThoughtProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open,
    });

    const [duration, setDuration] = useState<number | undefined>(undefined);
    const startTimeRef = useRef<number | null>(null);
    const wasStreamingRef = useRef(false);

    useEffect(() => {
      if (isStreaming) {
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(
          Math.max(1, Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S))
        );
        startTimeRef.current = null;
      }
    }, [isStreaming]);

    useEffect(() => {
      if (isStreaming && !isOpen) {
        setIsOpen(true);
      }
    }, [isStreaming, isOpen, setIsOpen]);

    useEffect(() => {
      if (wasStreamingRef.current && !isStreaming) {
        setIsOpen(false);
      }
      wasStreamingRef.current = isStreaming;
    }, [isStreaming, setIsOpen]);

    const ctx = useMemo(
      () => ({ duration, isStreaming }),
      [duration, isStreaming]
    );

    return (
      <ChainOfThoughtContext.Provider value={ctx}>
        <Collapsible
          className={cn("not-prose group mb-4 w-full", className)}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ChainOfThoughtContext.Provider>
    );
  }
);

ChainOfThought.displayName = "ChainOfThought";

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  children?: ReactNode;
};

export const ChainOfThoughtHeader = memo(
  ({ className, children, ...props }: ChainOfThoughtHeaderProps) => {
    const { isStreaming, duration } = useChainOfThought();

    const label =
      children ??
      (isStreaming || duration === 0 ? (
        <Shimmer duration={1}>Thinking…</Shimmer>
      ) : duration === undefined ? (
        <span>Thought process</span>
      ) : (
        <span>Thought for {duration}s</span>
      ));

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
          className
        )}
        {...props}
      >
        <BrainIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
    );
  }
);

ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader";

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const ChainOfThoughtContent = memo(
  ({ className, ...props }: ChainOfThoughtContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-2 space-y-3 text-sm outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1",
        className
      )}
      {...props}
    />
  )
);

ChainOfThoughtContent.displayName = "ChainOfThoughtContent";

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon;
  label: string;
  description?: string;
  status?: "complete" | "active" | "pending";
};

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon = DotIcon,
    label,
    description,
    status = "complete",
    children,
    ...props
  }: ChainOfThoughtStepProps) => {
    const statusIcon =
      status === "active" ? (
        <Loader2Icon className="size-3.5 animate-spin text-primary" />
      ) : status === "pending" ? (
        <CircleIcon className="size-3.5 text-muted-foreground/40" />
      ) : (
        <Icon className="size-3.5 text-muted-foreground" />
      );

    return (
      <div
        className={cn(
          "rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5",
          className
        )}
        {...props}
      >
        <div className="flex gap-2">
          <div className="mt-0.5 shrink-0">{statusIcon}</div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[13px] font-medium leading-snug text-foreground/90">
              {label}
            </p>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    );
  }
);

ChainOfThoughtStep.displayName = "ChainOfThoughtStep";

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">;

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div
      className={cn("mt-2 flex flex-wrap gap-1.5", className)}
      {...props}
    />
  )
);

ChainOfThoughtSearchResults.displayName = "ChainOfThoughtSearchResults";

export type ChainOfThoughtSearchResultProps = ComponentProps<"span">;

export const ChainOfThoughtSearchResult = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultProps) => (
    <span
      className={cn(
        "inline-flex max-w-full truncate rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
);

ChainOfThoughtSearchResult.displayName = "ChainOfThoughtSearchResult";

export type ChainOfThoughtImageProps = ComponentProps<"div"> & {
  caption?: string;
};

export const ChainOfThoughtImage = memo(
  ({ className, caption, children, ...props }: ChainOfThoughtImageProps) => (
    <div className={cn("mt-2 space-y-1.5", className)} {...props}>
      {children}
      {caption ? (
        <p className="text-[11px] text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  )
);

ChainOfThoughtImage.displayName = "ChainOfThoughtImage";

export type ChainOfThoughtMarkdownProps = ComponentProps<"div"> & {
  children: string;
};

/** Renders model reasoning text as markdown (same pipeline as Reasoning). */
export const ChainOfThoughtMarkdown = memo(
  ({ className, children, ...props }: ChainOfThoughtMarkdownProps) => (
    <div className={cn("text-sm text-muted-foreground", className)} {...props}>
      <Streamdown plugins={streamdownPlugins}>{children}</Streamdown>
    </div>
  )
);

ChainOfThoughtMarkdown.displayName = "ChainOfThoughtMarkdown";
