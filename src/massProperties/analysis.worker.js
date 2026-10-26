/* eslint-env worker */
/* global globalThis */
import {preprocess,fitIdentification} from './identification';
const workerScope=globalThis;
workerScope.onmessage=({data})=>{
  try {
    workerScope.postMessage({type:'progress',progress:5});
    const prepared=preprocess(data.rows,data.settings);
    if(data.preview){workerScope.postMessage({type:'preview',prepared});return;}
    const result=fitIdentification(prepared,data.settings,p=>workerScope.postMessage({type:'progress',...p}));
    workerScope.postMessage({type:'result',prepared,result});
  }catch(error){workerScope.postMessage({type:'error',error:error.message});}
};
