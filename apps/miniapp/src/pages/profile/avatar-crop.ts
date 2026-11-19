const outputSize = 512;
const maxZoom = 3;
const center = outputSize / 2;

type Point = { x: number; y: number };
type Gesture = { center: Point; distance: number };
type CropNode = { node: WechatMiniprogram.Canvas; width: number; left: number; top: number };

export class AvatarCrop {
    private readonly context;
    private readonly baseScale: number;
    private gesture: Gesture | null = null;
    private left = 0;
    private top = 0;
    zoom = 1;

    constructor(private readonly viewport: CropNode, private readonly image: WechatMiniprogram.Image) {
        const canvas = viewport.node;
        canvas.width = canvas.height = outputSize;
        this.context = canvas.getContext('2d');
        this.baseScale = outputSize / Math.min(image.width, image.height);
        this.render(center - image.width * this.baseScale / 2, center - image.height * this.baseScale / 2);
    }

    private render(left: number, top: number): void {
        const scale = this.baseScale * this.zoom;
        this.left = Math.max(Math.min(0, outputSize - this.image.width * scale), Math.min(0, left));
        this.top = Math.max(Math.min(0, outputSize - this.image.height * scale), Math.min(0, top));
        this.paint();
    }

    private paint(preview = true): void {
        const { context } = this;
        const scale = this.baseScale * this.zoom;
        context.clearRect(0, 0, outputSize, outputSize);
        context.drawImage(this.image, this.left, this.top, this.image.width * scale, this.image.height * scale);
        if (!preview) return;
        const radius = center - 2;
        context.beginPath();
        context.rect(0, 0, outputSize, outputSize);
        context.moveTo(center + radius, center);
        context.arc(center, center, radius, 0, 2 * Math.PI, true);
        context.fillStyle = 'rgba(15, 20, 17, .57)';
        context.fill('evenodd');
        context.beginPath();
        context.arc(center, center, radius, 0, 2 * Math.PI);
        context.lineWidth = 3;
        context.strokeStyle = 'rgba(255, 255, 255, .92)';
        context.stroke();
    }

    private gestureAt(touches: WechatMiniprogram.TouchDetail[]): Gesture | null {
        const [first, second] = touches;
        if (!first) return null;
        const scale = outputSize / this.viewport.width;
        const x = second ? (first.clientX + second.clientX) / 2 : first.clientX;
        const y = second ? (first.clientY + second.clientY) / 2 : first.clientY;
        return {
            center: { x: (x - this.viewport.left) * scale, y: (y - this.viewport.top) * scale },
            distance: second ? Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) : 0
        };
    }

    begin(touches: WechatMiniprogram.TouchDetail[]): void {
        this.gesture = this.gestureAt(touches);
    }

    move(touches: WechatMiniprogram.TouchDetail[]): void {
        const next = this.gestureAt(touches);
        const previous = this.gesture;
        this.gesture = next;
        if (!next || !previous || Boolean(next.distance) !== Boolean(previous.distance)) return;
        const ratio = previous.distance ? next.distance / previous.distance : 1;
        this.adjust(this.zoom * ratio, previous.center, next.center);
    }

    setZoom(zoom: number): void {
        const midpoint = { x: center, y: center };
        this.gesture = null;
        this.adjust(zoom, midpoint, midpoint);
    }

    private adjust(zoom: number, anchor: Point, destination: Point): void {
        const nextZoom = Math.min(maxZoom, Math.max(1, zoom));
        const ratio = nextZoom / this.zoom;
        this.zoom = nextZoom;
        this.render(destination.x - (anchor.x - this.left) * ratio, destination.y - (anchor.y - this.top) * ratio);
    }

    async exportImage(): Promise<string> {
        this.paint(false);
        try {
            return await new Promise((resolve, reject) => {
                wx.canvasToTempFilePath({
                    canvas: this.viewport.node,
                    x: 0, y: 0, width: outputSize, height: outputSize,
                    destWidth: outputSize, destHeight: outputSize, fileType: 'png',
                    success: result => resolve(result.tempFilePath),
                    fail: () => reject(new Error('无法生成头像，请重试'))
                });
            });
        } finally {
            this.paint();
        }
    }
}

export async function openAvatarCrop(path: string): Promise<AvatarCrop> {
    const viewport = await new Promise<CropNode>((resolve, reject) => {
        wx.createSelectorQuery().select('#avatar-crop-canvas').fields({ node: true, size: true, rect: true }, result => {
            const viewport = result as unknown as CropNode | null;
            if (viewport?.node && viewport.width > 0) resolve(viewport);
            else reject(new Error('无法打开头像裁切，请重试'));
        }).exec();
    });
    const image = await new Promise<WechatMiniprogram.Image>((resolve, reject) => {
        const image = viewport.node.createImage();
        const failure = () => reject(new Error('无法读取这张照片，请重新选择'));
        image.onload = () => image.width > 0 && image.height > 0 ? resolve(image) : failure();
        image.onerror = failure;
        image.src = path;
    });
    return new AvatarCrop(viewport, image);
}
