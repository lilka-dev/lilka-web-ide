import { test, expect } from '@playwright/test';

/**
 * Операції над картинками у справжньому браузері.
 *
 * Під Node канви немає, тож `check-images.mts` перевіряє лише арифметику
 * навколо малювання — округлення пропорцій і заганяння рамки в межі. Саме
 * малювання можна перевірити тільки тут.
 *
 * Головне, за чим стежать ці тести, — **жодного напівпрозорого пікселя**.
 * Прошивка знає лише «видно» і «не видно» (`loadImagePNG` зводить альфу до
 * одного біта), тож будь-яке згладжування обернулося б на залізі брудною
 * облямівкою навколо спрайта. Поки малювання йде найближчим сусідом, кожен
 * піксель результату — копія одного пікселя первотвору, і нових значень
 * альфи не виникає.
 */

test.describe('операції над картинкою', () => {
    test('поворот міняє сторони місцями і повністю оборотний', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async () => {
            const module = await import('/src/emulator/image-edit.ts');
            const canvas = document.createElement('canvas');
            canvas.width = 8;
            canvas.height = 4;
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#ff0000';
            context.fillRect(0, 0, 4, 4);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            const source = new Uint8Array(await blob!.arrayBuffer());

            const right = await module.rotateImage(source, 'right');
            const back = await module.rotateImage(right, 'left');

            const read = async (bytes: Uint8Array) => {
                const bitmap = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer]));
                const c = document.createElement('canvas');
                c.width = bitmap.width;
                c.height = bitmap.height;
                const x = c.getContext('2d')!;
                x.imageSmoothingEnabled = false;
                x.drawImage(bitmap, 0, 0);
                const d = x.getImageData(0, 0, bitmap.width, bitmap.height).data;
                let semi = 0;
                for (let i = 3; i < d.length; i += 4) if (d[i] !== 0 && d[i] !== 255) semi++;
                return { width: bitmap.width, height: bitmap.height, first: [...d.slice(0, 4)], semi };
            };

            return { source: await read(source), right: await read(right), back: await read(back) };
        });

        // 8×4 стає 4×8
        expect(result.right.width).toBe(4);
        expect(result.right.height).toBe(8);

        // Туди-назад дає точно те саме — саме тому поворот не потребує вікна
        expect(result.back.width).toBe(result.source.width);
        expect(result.back.height).toBe(result.source.height);
        expect(result.back.first).toEqual(result.source.first);

        // Жодного напівпрозорого пікселя на жодному кроці
        expect(result.right.semi).toBe(0);
        expect(result.back.semi).toBe(0);
    });

    test('збільшення й обрізання не створюють напівпрозорих пікселів', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async () => {
            const module = await import('/src/emulator/image-edit.ts');
            const canvas = document.createElement('canvas');
            canvas.width = 8;
            canvas.height = 4;
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#ff0000';
            context.fillRect(0, 0, 4, 4);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            const source = new Uint8Array(await blob!.arrayBuffer());

            const read = async (bytes: Uint8Array) => {
                const bitmap = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer]));
                const c = document.createElement('canvas');
                c.width = bitmap.width;
                c.height = bitmap.height;
                const x = c.getContext('2d')!;
                x.imageSmoothingEnabled = false;
                x.drawImage(bitmap, 0, 0);
                const d = x.getImageData(0, 0, bitmap.width, bitmap.height).data;
                let semi = 0;
                for (let i = 3; i < d.length; i += 4) if (d[i] !== 0 && d[i] !== 255) semi++;
                return { width: bitmap.width, height: bitmap.height, first: [...d.slice(0, 4)], semi };
            };

            return {
                scaled: await read(await module.resizeImage(source, 32, 16)),
                mirrored: await read(await module.mirrorImage(source)),
                cropped: await read(await module.cropImage(source, { x: 4, y: 0, width: 4, height: 4 })),
            };
        });

        expect(result.scaled.width).toBe(32);
        expect(result.scaled.height).toBe(16);

        // Збільшення найближчим сусідом не розмиває край — альфа лишається
        // двозначною, інакше на Лілці була б облямівка
        expect(result.scaled.semi).toBe(0);
        expect(result.mirrored.semi).toBe(0);
        expect(result.cropped.semi).toBe(0);

        // Дзеркало справді міняє боки: ліва колонка стає прозорою
        expect(result.mirrored.first[3]).toBe(0);

        // Вирізана права половина — суцільно прозора
        expect(result.cropped.width).toBe(4);
        expect(result.cropped.first[3]).toBe(0);
    });
});
