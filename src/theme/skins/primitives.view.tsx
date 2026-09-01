import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactElement,
  ReactNode,
  SVGAttributes,
} from "react";

export type VDSemanticTextTone = "primary" | "secondary" | "muted";
export type VDSemanticStatus =
  | "accent"
  | "danger"
  | "secondary"
  | "success"
  | "warning";
export type VDActionTone = "accent" | "danger" | "quiet";
export type VDIconName = "chevron";

interface VDTextProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "p" | "span";
  children?: ReactNode;
  status?: VDSemanticStatus;
  tone?: VDSemanticTextTone;
}

export function VDText({
  as = "span",
  children,
  status,
  tone = "primary",
  ...props
}: VDTextProps) {
  const semanticProps = getTextSemanticProps({ status, tone });

  if (as === "div") {
    return (
      <div {...props} {...semanticProps}>
        {children}
      </div>
    );
  }

  if (as === "p") {
    return (
      <p {...props} {...semanticProps}>
        {children}
      </p>
    );
  }

  return (
    <span {...props} {...semanticProps}>
      {children}
    </span>
  );
}

interface VDHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  children?: ReactNode;
  level: 1 | 2 | 3 | 4;
  tone?: Exclude<VDSemanticTextTone, "muted">;
}

export function VDHeading({
  children,
  level,
  tone = "primary",
  ...props
}: VDHeadingProps) {
  const semanticProps = { "data-vd-text": tone };

  if (level === 1) {
    return (
      <h1 {...props} {...semanticProps}>
        {children}
      </h1>
    );
  }

  if (level === 2) {
    return (
      <h2 {...props} {...semanticProps}>
        {children}
      </h2>
    );
  }

  if (level === 3) {
    return (
      <h3 {...props} {...semanticProps}>
        {children}
      </h3>
    );
  }

  return (
    <h4 {...props} {...semanticProps}>
      {children}
    </h4>
  );
}

interface VDActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: VDActionTone;
}

export function VDAction({ tone, ...props }: VDActionProps) {
  return <button {...props} data-vd-component="button" data-vd-tone={tone} />;
}

interface VDBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status?: VDSemanticStatus;
}

export function VDBadge({ status, ...props }: VDBadgeProps) {
  return <span {...props} data-vd-component="badge" data-vd-status={status} />;
}

type VDCardProps = HTMLAttributes<HTMLDivElement>;

export function VDCard(props: VDCardProps) {
  return <div {...props} data-vd-component="card" />;
}

type VDDivRowProps = HTMLAttributes<HTMLDivElement> & { as?: "div" };
type VDButtonRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  as: "button";
};
type VDRowProps = VDDivRowProps | VDButtonRowProps;

export function VDRow(props: VDDivRowProps): ReactElement;
export function VDRow(props: VDButtonRowProps): ReactElement;
export function VDRow(props: VDRowProps): ReactElement {
  if (props.as === "button") {
    const { as: _as, ...buttonProps } = props;

    return <button {...buttonProps} data-vd-component="row" />;
  }

  const { as: _as, ...divProps } = props;

  return <div {...divProps} data-vd-component="row" />;
}

interface VDIconProps extends SVGAttributes<SVGSVGElement> {
  children?: ReactNode;
  name: VDIconName;
}

export function VDIcon({ children, name, ...props }: VDIconProps) {
  return (
    <svg {...props} data-vd-icon={name}>
      {children}
    </svg>
  );
}

function getTextSemanticProps({
  status,
  tone,
}: {
  status: VDSemanticStatus | undefined;
  tone: VDSemanticTextTone;
}) {
  if (status) {
    return { "data-vd-status": status };
  }

  if (tone === "muted") {
    return { "data-vd-muted": true };
  }

  return { "data-vd-text": tone };
}
