import { describe, expect, it } from 'vitest'
import type { V1CSIDriver, V1PersistentVolume, V1PersistentVolumeClaim, V1StorageClass, V1VolumeAttachment } from '@kubernetes/client-node'
import { accessModes, pvSource, toCsiDriverRow, toPvcRow, toPvRow, toStorageClassRow, toVolumeAttachmentRow } from './storage'

describe('persistent volumes', () => {
  const pv = {
    metadata: { name: 'pv-1' },
    spec: {
      capacity: { storage: '10Gi' },
      accessModes: ['ReadWriteOnce', 'ReadOnlyMany'],
      persistentVolumeReclaimPolicy: 'Retain',
      storageClassName: 'fast',
      claimRef: { namespace: 'prod', name: 'data' },
      csi: { driver: 'ebs.csi.aws.com', volumeHandle: 'vol-123' },
      nodeAffinity: { required: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'topology.kubernetes.io/zone', operator: 'In', values: ['a', 'b'] }] }] } },
    },
    status: { phase: 'Bound' },
  } as V1PersistentVolume

  it('colunas como o kubectl', () => {
    expect(toPvRow(pv)).toMatchObject({
      status: 'Bound',
      statusClass: 'running',
      capacity: '10Gi',
      capacityBytes: 10 * 2 ** 30,
      accessModes: 'RWO,ROX',
      reclaimPolicy: 'Retain',
      claim: { namespace: 'prod', name: 'data' },
      kind: 'CSI',
      source: 'ebs.csi.aws.com (vol-123)',
      nodeAffinity: 'topology.kubernetes.io/zone in (a,b)',
      namespace: '',
    })
  })

  it('Terminating quando apagado mas preso por finalizer', () => {
    expect(toPvRow({ ...pv, metadata: { name: 'x', deletionTimestamp: new Date() } }).status).toBe('Terminating')
  })

  it('Available é concluído, Released pendente', () => {
    expect(toPvRow({ status: { phase: 'Available' } }).statusClass).toBe('succeeded')
    expect(toPvRow({ status: { phase: 'Released' } }).statusClass).toBe('pending')
  })

  it('origem de plugin antigo pelo nome do campo', () => {
    expect(pvSource({ spec: { capacity: {}, gcePersistentDisk: { pdName: 'd' } } } as V1PersistentVolume)).toEqual({ kind: 'GcePersistentDisk', source: '' })
  })

  it('modos de acesso abreviados', () => {
    expect(accessModes(['ReadWriteMany', 'ReadWriteOncePod'])).toBe('RWX,RWOP')
  })
})

describe('claims', () => {
  it('pendente mostra o pedido; capacidade só depois de ligar', () => {
    const row = toPvcRow({
      metadata: { name: 'data', namespace: 'prod' },
      spec: { resources: { requests: { storage: '5Gi' } }, accessModes: ['ReadWriteOnce'], storageClassName: 'fast' },
      status: { phase: 'Pending' },
    } as V1PersistentVolumeClaim)
    expect(row).toMatchObject({ status: 'Pending', statusClass: 'pending', requested: '5Gi', capacity: '', capacityBytes: null, accessModes: 'RWO', volumeMode: 'Filesystem' })
  })

  it('Lost é falha', () => {
    expect(toPvcRow({ status: { phase: 'Lost' } }).statusClass).toBe('failed')
  })
})

describe('volume attachments', () => {
  const va = (status: object) =>
    toVolumeAttachmentRow({ metadata: { name: 'csi-1' }, spec: { attacher: 'ebs', nodeName: 'n1', source: { persistentVolumeName: 'pv-1' } }, status } as V1VolumeAttachment)

  it.each<[string, object, string, string]>([
    ['anexado', { attached: true }, 'Anexado', 'running'],
    ['anexando', { attached: false }, 'Anexando', 'pending'],
    ['erro de detach', { attached: true, detachError: { message: 'busy' } }, 'Erro', 'failed'],
  ])('%s', (_, status, text, cls) => {
    expect(va(status)).toMatchObject({ status: text, statusClass: cls, pv: 'pv-1', node: 'n1' })
  })
})

describe('storage classes e drivers', () => {
  it('padrão pelo annotation (inclusive o beta) e defaults da API', () => {
    const row = toStorageClassRow({ metadata: { name: 's', annotations: { 'storageclass.beta.kubernetes.io/is-default-class': 'true' } }, provisioner: 'p' } as V1StorageClass)
    expect(row).toMatchObject({ isDefault: true, reclaimPolicy: 'Delete', volumeBindingMode: 'Immediate', allowVolumeExpansion: false })
  })

  it('CSIDriver com defaults da API', () => {
    expect(toCsiDriverRow({ metadata: { name: 'd' }, spec: {} } as V1CSIDriver)).toMatchObject({
      attachRequired: true,
      podInfoOnMount: false,
      modes: ['Persistent'],
      fsGroupPolicy: 'ReadWriteOnceWithFSType',
    })
  })
})
