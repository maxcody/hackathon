import { Button, type ButtonProps } from "@astryxdesign/core/Button";
import { Spinner } from "@astryxdesign/core/Spinner";

/**
 * Button that keeps its label while busy: the spinner replaces the icon slot
 * instead of covering the whole button (Astryx's own `isLoading` hides the label).
 */
export function LoadingButton({ isLoading, icon, isDisabled, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      icon={isLoading ? <Spinner size="sm" /> : icon}
      isDisabled={isDisabled || isLoading}
    />
  );
}
