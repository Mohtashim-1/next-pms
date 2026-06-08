/**
 * Internal dependencies.
 */
import { AllocationItemRender } from "./allocationItemRender";
import { LeaveItemRender } from "./leaveItemRender";
import type { ResourceTimeLineItemProps } from "../../types";

const ResourceTimeLineItem = ({ item, itemContext, getItemProps, getResizeProps }: ResourceTimeLineItemProps) => {
  if (item.type === "draft") {
    const itemProps = getItemProps(item.itemProps);
    return (
      <div {...itemProps}>
        <div className="rct-item-content flex h-full items-center px-2 text-xs font-medium text-primary">New allocation</div>
      </div>
    );
  }

  if (item.type == "leave") {
    return (
      <LeaveItemRender
        item={item}
        itemContext={itemContext}
        getItemProps={getItemProps}
        getResizeProps={getResizeProps}
      />
    );
  }
  return (
    <AllocationItemRender
      item={item}
      itemContext={itemContext}
      getItemProps={getItemProps}
      getResizeProps={getResizeProps}
    />
  );
};

export { ResourceTimeLineItem };
