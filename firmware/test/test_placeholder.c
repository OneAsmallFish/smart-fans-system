/* firmware/test/test_placeholder.c
 * Unity 测试框架占位文件
 * 实际测试用例由 Wave 2/3 各驱动任务填充
 */
#include "unity.h"

void setUp(void) {}
void tearDown(void) {}

/* Placeholder — replaced by T9-T22 component tests */
TEST_CASE("scaffold sanity check", "[scaffold]")
{
    TEST_ASSERT_EQUAL(1, 1);
}
