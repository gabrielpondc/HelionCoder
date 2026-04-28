import { maybeUpdateHelionReleaseBinary } from '../../utils/helionReleaseUpdater.js'

type UpdateOptions = {
	binaryPath: string
	cwd: string
}

export async function maybeUpdateBackendBinary({
	binaryPath,
	cwd,
}: UpdateOptions): Promise<string> {
	const result = await maybeUpdateHelionReleaseBinary({
		binaryPath,
		cwd,
		label: 'HelionCoder 后端',
	})
	return result.binaryPath
}
