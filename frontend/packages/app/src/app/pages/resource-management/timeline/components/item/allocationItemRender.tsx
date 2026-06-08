/**
 * External dependencies.
 */
import { getDayDiff, prettyDate } from "@next-pms/design-system";
import { Avatar, AvatarFallback, AvatarImage, Typography } from "@next-pms/design-system/components";

/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";
import { DeleteIcon } from "../../../components/resource-allocation-list";
import { getInitials } from "../../../utils/helper";
import { getAllocationColors } from "../../timelineColors";
import { isWideZoom, normalizeColorMode } from "../../timelineZoom";
import type { ResourceTimeLineItemProps } from "../../types";

const AllocationItemRender = ({
  item: resourceAllocation,
  itemContext,
  getItemProps,
  getResizeProps,
}: ResourceTimeLineItemProps) => {
  const { left: leftResizeProps, right: rightResizeProps } = getResizeProps();
  const { date: startDate } = prettyDate(resourceAllocation.allocation_start_date);
  const { date: endDate } = prettyDate(resourceAllocation.allocation_end_date);

  const dayDiff = getDayDiff(resourceAllocation.allocation_start_date, resourceAllocation.allocation_end_date);

  const getTitle = (isNeedFullTitle = false) => {
    const title = `${
      resourceAllocation.project_name ? resourceAllocation.project_name + " " : ""
    }${startDate} - ${endDate} (${resourceAllocation.hours_allocated_per_day} hours/day)`;

    if (isNeedFullTitle) {
      if (dayDiff == 0) {
        return `${resourceAllocation.project_name ? resourceAllocation.project_name + " " : ""}${startDate} (${
          resourceAllocation.hours_allocated_per_day
        } hours/day)`;
      }
      return title;
    }

    const compactLabels = isWideZoom(resourceAllocation.zoomLevel ?? (resourceAllocation.isShowMonth ? "month" : "week"));

    if (dayDiff <= 2 || (compactLabels && dayDiff <= 10)) {
      return "";
    }

    if (dayDiff <= 4) {
      return `${startDate} - ${endDate} (${resourceAllocation.hours_allocated_per_day} hours/day)`;
    }

    return title;
  };

  let itemProps = getItemProps(resourceAllocation.itemProps);

  const title = getTitle();
  const colorMode = normalizeColorMode({ colorMode: resourceAllocation.colorMode });
  const colors = getAllocationColors(resourceAllocation, colorMode);
  const compactLabels = isWideZoom(resourceAllocation.zoomLevel ?? (resourceAllocation.isShowMonth ? "month" : "week"));

  itemProps = {
    ...itemProps,
    style: {
      ...itemProps.style,
      padding: "1px",
      background: colors.background,
      borderRadius: "4px",
      border: `1px solid ${colors.border}`,
      borderWidth: 0,
      borderRightWidth: resourceAllocation.canDelete && itemContext.selected ? 3 : 0,
      overflow: dayDiff <= (compactLabels ? 30 * 3 : 10) ? "hidden" : "visible",
    },
  };

  return (
    <div {...itemProps} title={getTitle(true)}>
      {itemContext.useResizeHandle ? <div {...leftResizeProps} /> : ""}

      <div
        className={mergeClassNames("rct-item-content")}
        style={
          title
            ? { maxHeight: itemContext.dimensions.height }
            : { maxHeight: itemContext.dimensions.height, width: itemProps.style.width }
        }
      >
        <div
          className={mergeClassNames("flex justify-start gap-[2px] h-full w-full", !title && "justify-center")}
          style={{ alignItems: "center", maxHeight: itemContext.dimensions.height }}
        >
          {itemContext.selected && resourceAllocation.canDelete && (
            <DeleteIcon
              resourceAllocation={resourceAllocation}
              resourceAllocationPermission={{ delete: resourceAllocation.canDelete }}
              buttonClassName={mergeClassNames(
                "text-destructive z-[1000] mr-1 cusror-pointer hover:text-destructive/80 w-7 h-4 p-0"
              )}
              onSubmit={resourceAllocation.onDelete}
            />
          )}

          {(!itemContext.selected || !resourceAllocation.canDelete) && (
            <Avatar className="w-5 h-5 mr-1">
              {resourceAllocation?.customerData?.image && (
                <AvatarImage src={decodeURIComponent(resourceAllocation?.customerData?.image)} />
              )}
              <AvatarFallback className="bg-gray-300 text-black">
                {getInitials(resourceAllocation?.customerData?.name[0])}
              </AvatarFallback>
            </Avatar>
          )}

          {title && (
            <Typography
              variant="small"
              className="text-[12px] truncate overflow-hidden block"
              style={{ color: colors.text }}
            >
              {title}
            </Typography>
          )}
        </div>
      </div>
      {itemContext.useResizeHandle ? <div {...rightResizeProps} /> : ""}
    </div>
  );
};

export { AllocationItemRender };
