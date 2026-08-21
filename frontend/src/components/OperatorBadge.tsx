import { Icon } from "./Icon";

interface Props {
  operator: string;
  onSwitch: () => void;
}

export function OperatorBadge({ operator, onSwitch }: Props) {
  return (
    <button
      type="button"
      className="operator"
      onClick={onSwitch}
      title="Skift bruger"
    >
      <span className="operator__avatar" aria-hidden="true">
        {operator.slice(0, 2).toUpperCase()}
      </span>
      <span className="operator__text">
        <span className="operator__initials">{operator}</span>
        <span className="operator__hint">Skift bruger</span>
      </span>
      <Icon name="rotate-ccw" size={15} className="operator__icon" />
    </button>
  );
}
