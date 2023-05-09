import { DateTime } from "luxon";
import { innerDateFormat, TaskRegularExpressions } from "./tasks";

export function momentToDateTime(m: moment.Moment) {
    return DateTime.fromFormat(m.format(innerDateFormat), innerDateFormat);
}

export function DateTimeToMoment(d: DateTime){
    return d.toFormat(innerDateFormat);
}

export function removeHightlightMarker(text: string){
    var match = TaskRegularExpressions.highlightRegex.exec(text);
    while(match){
        text = text.replace(match[0], match[1]);
    }
    return text;
}
/**
 * @deprecated
 * @param momentFormat 
 * @returns 
 */
export function momentToRegex(momentFormat: string) : RegExp {
	momentFormat = momentFormat.replaceAll(".", "\\.");
	momentFormat = momentFormat.replaceAll(",", "\\,");
	momentFormat = momentFormat.replaceAll("-", "\\-");
	momentFormat = momentFormat.replaceAll(":", "\\:");
	momentFormat = momentFormat.replaceAll(" ", "\\s");
	
	momentFormat = momentFormat.replace("dddd", "\\w{1,}");
	momentFormat = momentFormat.replace("ddd", "\\w{1,3}");
	momentFormat = momentFormat.replace("dd", "\\w{2}");
	momentFormat = momentFormat.replace("d", "\\d{1}");
	
	momentFormat = momentFormat.replace("YYYY", "\\d{4}");
	momentFormat = momentFormat.replace("YY", "\\d{2}");
	
	momentFormat = momentFormat.replace("MMMM", "\\w{1,}");
	momentFormat = momentFormat.replace("MMM", "\\w{3}");
	momentFormat = momentFormat.replace("MM", "\\d{2}");
	
	momentFormat = momentFormat.replace("DDDD", "\\d{3}");
	momentFormat = momentFormat.replace("DDD", "\\d{1,3}");
	momentFormat = momentFormat.replace("DD", "\\d{2}");
	momentFormat = momentFormat.replace("D", "\\d{1,2}");
	
	momentFormat = momentFormat.replace("ww", "\\d{1,2}");
	return new RegExp("/^(" + momentFormat + ")$/");
};

