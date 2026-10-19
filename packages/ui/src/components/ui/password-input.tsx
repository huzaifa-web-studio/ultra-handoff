import { cn } from "cn";
import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { Button } from "./button";
import { Input } from "./input";

function PasswordInput({
	className,
	...props
}: React.ComponentProps<typeof Input>) {
	const [visible, setVisible] = React.useState(false);

	return (
		<div className="relative">
			<Input
				type={visible ? "text" : "password"}
				className={cn(
					"pr-10 [&::-ms-reveal]:hidden [&::-webkit-credentials-auto-fill-button]:hidden",
					className,
				)}
				{...props}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute inset-y-0 right-1 flex items-center active:!transform-none"
				onPress={() => setVisible((v) => !v)}
				aria-label={visible ? "Hide password" : "Show password"}
			>
				{visible ? <EyeOff /> : <Eye />}
			</Button>
		</div>
	);
}

export { PasswordInput };
