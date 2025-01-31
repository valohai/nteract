import { PayloadMessage } from "@nteract/types";
import { from, Observable, Subscriber } from "rxjs";
import { filter, map, mergeMap } from "rxjs/operators";
import { executeRequest, message } from "./messages";
import { ExecuteRequest, JupyterMessage, MessageType } from "./types";

export * from "./types";

export interface CreateMessageFields extends Partial<JupyterMessage> {
  header?: never;
}

// TODO: Deprecate
export function createMessage<MT extends MessageType>(
  msg_type: MT,
  fields: CreateMessageFields = {}
): JupyterMessage<MT> {
  return { ...message({ msg_type }), ...fields };
}

// TODO: Deprecate
export function createExecuteRequest(code: string = ""): ExecuteRequest {
  return executeRequest(code, {});
}

/**
 * operator for getting all messages that declare their parent header as
 * parentMessage's header.
 *
 * @param parentMessage The parent message whose children we should fetch
 *
 * @returns A function that takes an Observable of kernel messages and returns
 * messages that are children of parentMessage.
 */
export function childOf(
  parentMessage: JupyterMessage
): (source: Observable<JupyterMessage<MessageType, any>>) => any {
  return (source: Observable<JupyterMessage>) => {
    const parentMessageID: string = parentMessage.header.msg_id;
    return Observable.create((subscriber: Subscriber<JupyterMessage>) =>
      source.subscribe(
        msg => {
          // strictly speaking, in order for the message to be a child of the
          // parent message, it has to both be a message and have a parent to
          // begin with
          if (!msg || !msg.parent_header || !msg.parent_header.msg_id) {
            if (process.env.DEBUG === "true") {
              console.warn("no parent_header.msg_id on message", msg);
            }
            return;
          }

          if (parentMessageID === msg.parent_header.msg_id) {
            subscriber.next(msg);
          }
        },
        // be sure to handle errors and completions as appropriate and
        // send them along
        err => subscriber.error(err),
        () => subscriber.complete()
      )
    );
  };
}

/**
 * ofMessageType is an Rx Operator that filters on msg.header.msg_type
 * being one of messageTypes.
 *
 * @param messageTypes The message types to filter on
 *
 * @returns An Observable containing only messages of the specified types
 */
export const ofMessageType = (
  ...messageTypes: Array<string | [string]>
): ((source: Observable<JupyterMessage>) => Observable<JupyterMessage>) => {
  // Switch to the splat mode
  if (messageTypes.length === 1 && Array.isArray(messageTypes[0])) {
    return ofMessageType(...(messageTypes[0] as [string]));
  }

  return (source: Observable<JupyterMessage>) =>
    Observable.create((subscriber: Subscriber<JupyterMessage>) =>
      source.subscribe(
        msg => {
          if (!msg.header || !msg.header.msg_type) {
            subscriber.error(new Error("no header.msg_type on message"));
            return;
          }

          if (messageTypes.indexOf(msg.header.msg_type) !== -1) {
            subscriber.next(msg);
          }
        },
        // be sure to handle errors and completions as appropriate and
        // send them along
        err => subscriber.error(err),
        () => subscriber.complete()
      )
    );
};

/**
 * Create an object that adheres to the jupyter notebook specification.
 * http://jupyter-client.readthedocs.io/en/latest/messaging.html
 *
 * @param msg Message that has content which can be converted to nbformat
 *
 * @returns Message with the associated output type
 */
export function convertOutputMessageToNotebookFormat(msg: JupyterMessage) {
  return {
    ...msg.content,
    output_type: msg.header.msg_type
  };
}

/**
 * Convert raw Jupyter messages that are output messages into nbformat style
 * outputs
 *
 * > o$ = iopub$.pipe(
 *     childOf(originalMessage),
 *     outputs()
 *   )
 */
export const outputs = () => (source: Observable<JupyterMessage>) =>
  source.pipe(
    ofMessageType("execute_result", "display_data", "stream", "error"),
    map(convertOutputMessageToNotebookFormat)
  );

/**
 * Get all messages for updating a display output.
 */
export const updatedOutputs = () => (source: Observable<JupyterMessage>) =>
  source.pipe(
    ofMessageType("update_display_data"),
    map(msg => ({ ...msg.content, output_type: "display_data" }))
  );

/**
 * Get all the payload message content from an observable of jupyter messages
 *
 * > p$ = shell$.pipe(
 *     childOf(originalMessage),
 *     payloads()
 *   )
 */
export const payloads = () => (
  source: Observable<JupyterMessage>
): Observable<PayloadMessage> =>
  source.pipe(
    ofMessageType("execute_reply"),
    map(entry => entry.content.payload),
    filter(Boolean),
    mergeMap(p => from(p))
  );

/**
 * Get all the execution counts from an observable of jupyter messages
 */
export const executionCounts = () => (source: Observable<JupyterMessage>) =>
  source.pipe(
    ofMessageType("execute_input", "execute_reply"),
    map(entry => entry.content.execution_count)
  );

/**
 * Get all statuses of all running kernels.
 */
export const kernelStatuses = () => (source: Observable<JupyterMessage>) =>
  source.pipe(
    ofMessageType("status"),
    map(entry => entry.content.execution_state)
  );

export const inputRequests = () => (source: Observable<JupyterMessage>) =>
  source.pipe(
    ofMessageType("input_request"),
    map(entry => entry.content)
  );

export * from "./messages";
