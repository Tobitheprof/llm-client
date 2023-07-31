import {
  FunctionExec,
  PromptFunction,
  PromptFunctionExtraOptions,
} from './types.js';
import { stringToObject } from './util.js';
import { AI } from './wrap.js';

const functionCallRe = /(\w+)\((.*)\)/s;
const thoughtRe = /Thought:(.*)$/gm;

const executeFunction = async (
  funcInfo: Readonly<PromptFunction>,
  funcArgJSON: string,
  extra: Readonly<PromptFunctionExtraOptions>
): Promise<FunctionExec> => {
  let args;

  if (funcInfo.inputSchema === undefined) {
    const res =
      funcInfo.func.length === 1
        ? await funcInfo.func(extra)
        : await funcInfo.func();
    return {
      name: funcInfo.name,
      result: JSON.stringify(res, null, 2),
      resultValue: res,
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args = stringToObject<any>(funcArgJSON, funcInfo.inputSchema);
  } catch (e) {
    return {
      name: funcInfo.name,
      parsingError: { error: (e as Error).message, data: funcArgJSON },
    };
  }

  const res =
    funcInfo.func.length === 2
      ? await funcInfo.func(args, extra)
      : await funcInfo.func(args);

  return {
    name: funcInfo.name,
    args,
    result: JSON.stringify(res, null, 2),
    resultValue: res,
  };
};

export const processFunction = async (
  value: string,
  functions: readonly PromptFunction[],
  ai: Readonly<AI>,
  sessionID?: string
): Promise<FunctionExec> => {
  let funcName = '';
  let funcArgs = '';
  let v: string[] | null;

  // extract thoughts
  const tm = value.matchAll(thoughtRe);
  const reasoning: string[] = [];

  for (const m of tm) {
    reasoning.push(m[1].trim());
  }

  // extract function calls
  if ((v = functionCallRe.exec(value)) !== null) {
    funcName = v[1].trim();
    funcArgs = v[2].trim();
  }

  const func = functions.find((v) => v.name === funcName);

  // add {} to object args if missing
  if (func?.inputSchema?.type === 'object' && !funcArgs.startsWith('{')) {
    funcArgs = `{${funcArgs}}`;
  }

  let funcExec: FunctionExec = { name: funcName, reasoning };

  // return final result
  if (funcName === 'finalResult') {
    funcExec.result = funcArgs;
    return funcExec;
  }

  // execute value function calls
  if (func) {
    funcExec = await executeFunction(func, funcArgs, {
      ai,
      sessionID,
    });

    if (funcExec.parsingError) {
      funcExec.result = `Fix error and repeat: ${funcExec.parsingError.error}`;
    } else if (!funcExec.result || funcExec.result.length === 0) {
      funcExec.result = `No data returned by function`;
    }
  } else {
    funcExec.result = `Function ${funcName} not found`;
  }

  return funcExec;
};

export const buildFunctionsPrompt = (
  functions: readonly PromptFunction[]
): string => {
  const funcList = functions.map((v) => ({
    name: v.name,
    description: v.description,
    parameters: v.inputSchema,
  }));

  const functionsJSON = JSON.stringify(funcList, null, 2);

  return `
Use these provided functions. Stick to these steps without creating custom functions.
For functions stick to the defined format.

Functions:
${functionsJSON}

Steps:

Thought: Plan the approach.
Function Call: functionName(parameters in json)
Result: Function result.
Thought: Review the outcome and decide next steps using results.
Repeat steps 2-4 until nearing solution.
Finally:

Thought: Prepare for the final result.
Function Call: finalResult(parameters in json)

Task:
  `;
  //   return `
  // To solve the below task think step-by-step in the format below. Use only below listed functions. Do not create custom functions. Function parameters are in json as per the functions json schema.

  // Functions:
  // ${functionsJSON}

  // Format:
  // Thought: Consider what to do.
  // Function Call: functionName(parameters)
  // Result: Function result.
  // Thought: Use the result to solve the task.
  // Repeat previous four steps as necessary.

  // Thought: Return final result.
  // Function Call: finalResult(parameters)

  // Task:
  // `;
};
