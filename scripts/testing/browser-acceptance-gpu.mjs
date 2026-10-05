/** Bind normalized GPU metadata to one successful immutable raw event; never changes case statuses or raw evidence. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const identityFields=['vendor','architecture','device','description'];

export function readRawGpuObservation(bytes,eventIndex) {
  const document=JSON.parse(bytes.toString());
  assert(Number.isSafeInteger(eventIndex)&&eventIndex>=0,'Select an exact raw GPU event index');
  const event=document.events?.[eventIndex];
  assert(event?.event==='webgpu-adapter-request'&&event.adapter&&event.error==null,'Selected raw GPU event is not a successful adapter observation');
  assert(typeof event.context==='string'&&event.context.trim()&&Number.isFinite(Date.parse(event.at)),'Raw GPU event needs its actual context and timestamp');
  for(const field of identityFields)assert(typeof event.adapter[field]==='string',`Raw GPU adapter identity field missing: ${field}`);
  assert(typeof event.adapter.isFallbackAdapter==='boolean','Raw fallback-adapter observation is missing');
  const features=event.features??event.adapter.features,limits=event.limits??event.adapter.limits;
  assert(Array.isArray(features)&&features.every(value=>typeof value==='string'),'Raw feature inventory is missing');
  assert(limits&&typeof limits==='object'&&!Array.isArray(limits)&&Object.keys(limits).length>0&&Object.values(limits).every(value=>Number.isFinite(value)&&value>=0),'Raw adapter limits are missing');
  assert(typeof document.osGpuDescription==='string'&&document.osGpuDescription.trim(),'Raw OS GPU observation is missing');
  return {document,event,adapterInfo:Object.fromEntries(identityFields.map(field=>[field,event.adapter[field]])),features,limits};
}

export function normalizeGpuHardware(hardware,artifact,bytes,eventIndex) {
  const {document,event,adapterInfo,features,limits}=readRawGpuObservation(bytes,eventIndex);
  return {...hardware,osGpuDescription:document.osGpuDescription,adapterDescription:adapterInfo.description,
    ...(!Object.hasOwn(hardware,'adapterLabel')&&typeof hardware.adapterDescription==='string'&&hardware.adapterDescription.trim()&&hardware.adapterDescription!==adapterInfo.description?{adapterLabel:hardware.adapterDescription}:{}),
    adapterInfo,features:structuredClone(features),limits:structuredClone(limits),isFallbackAdapter:event.adapter.isFallbackAdapter,
    rawAdapterObservation:{artifact,sha256:digest(bytes),eventIndex,context:event.context,at:event.at},
    evidence:[...new Set([...(hardware.evidence||[]),artifact])]};
}

export function validateGpuObservationBinding(hardware,artifacts) {
  const binding=hardware.rawAdapterObservation;
  assert(binding&&hardware.evidence.includes(binding.artifact),'Missing raw GPU event binding');
  const artifact=artifacts.get(binding.artifact);
  assert(artifact?.role==='gpu-log'&&artifact.sha256===binding.sha256&&digest(artifact.bytes)===binding.sha256,'Raw GPU artifact hash/role mismatch');
  const raw=readRawGpuObservation(artifact.bytes,binding.eventIndex);
  assert(binding.context===raw.event.context&&binding.at===raw.event.at,'Raw GPU context/time mismatch');
  assert.equal(hardware.osGpuDescription,raw.document.osGpuDescription,'OS GPU observation mismatch');
  assert.deepEqual(hardware.adapterInfo,raw.adapterInfo,'Raw GPU identity mismatch');
  assert.equal(hardware.adapterDescription,raw.adapterInfo.description,'Raw GPU description must remain unchanged, including an empty string');
  assert.equal(hardware.isFallbackAdapter,raw.event.adapter.isFallbackAdapter,'Raw fallback observation mismatch');
  assert.deepEqual(hardware.features,raw.features,'Raw GPU features mismatch');
  assert.deepEqual(hardware.limits,raw.limits,'Raw GPU limits mismatch');
  return raw;
}
