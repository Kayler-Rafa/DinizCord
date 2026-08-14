-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[];
