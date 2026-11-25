import { cn } from "~/utils/cn";

type ButtonProps = {
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | "ghost";
};

export const Button = ({
  children,
  onClick,
  className,
  disabled,
  type = "button",
  variant = "primary",
}: ButtonProps) => {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3.5 font-extrabold tracking-tight transition-all duration-150 cursor-pointer select-none text-sm sm:text-base",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5a3d]/50",
        "disabled:opacity-45 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none",
        variant === "primary" &&
          "bg-[#ff5a3d] text-white shadow-[0_8px_0_0_#c73a22] hover:-translate-y-0.5 hover:bg-[#ff6d54] active:translate-y-[3px] active:shadow-[0_4px_0_0_#c73a22]",
        variant === "secondary" &&
          "bg-[#0f9f8a] text-white shadow-[0_8px_0_0_#0a7a6a] hover:-translate-y-0.5 hover:bg-[#12b39c] active:translate-y-[3px] active:shadow-[0_4px_0_0_#0a7a6a]",
        variant === "ghost" &&
          "bg-white text-[#14213d] border-2 border-[#14213d]/15 shadow-[0_6px_0_0_rgba(20,33,61,0.12)] hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_3px_0_0_rgba(20,33,61,0.12)]",
        className
      )}
    >
      {children || "Click me"}
    </button>
  );
};
