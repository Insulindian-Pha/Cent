import type { ReactNode } from "react";
import { cn } from "@/utils";

/** 可点击遮罩 + 居中/底部弹层容器（满足 a11y，避免 div onClick） */
export function ModalBackdrop({
    onClose,
    children,
    className,
    align = "sheet",
}: {
    onClose: () => void;
    children: ReactNode;
    className?: string;
    /** sheet: 移动端自底部滑入；center: 始终居中 */
    align?: "sheet" | "center";
}) {
    return (
        <div
            className={cn(
                "fixed inset-0 z-50 flex justify-center",
                align === "sheet"
                    ? "items-end sm:items-center"
                    : "items-center",
                className,
            )}
        >
            <button
                type="button"
                aria-label="关闭"
                className="absolute inset-0 bg-black/50 border-0 p-0 cursor-default"
                onClick={onClose}
            />
            {children}
        </div>
    );
}
